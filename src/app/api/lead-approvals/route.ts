import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { Assignment, AuditLog, LeadApproval, OfficialReport, User } from '@/lib/models';

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function scopedWorkspace(role: string, ownWorkspace: string | null | undefined, requested: string | null) {
  return role === 'admin' ? ownWorkspace || null : requested;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || '';
  const workspaceId = scopedWorkspace(session.role, session.workspaceId, url.searchParams.get('workspaceId'));
  if (!workspaceId) return NextResponse.json({ message: 'Select a workspace.' }, { status: 400 });
  if (!validDate(date)) return NextResponse.json({ message: 'Choose a valid report date.' }, { status: 400 });
  if (session.role === 'admin' && url.searchParams.has('workspaceId') && url.searchParams.get('workspaceId') !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });

  await connectDB();
  const [reports, approvals, assignments] = await Promise.all([
    OfficialReport.find({ workspaceId, reportDate: date }).sort({ normalizedUsername: 1 }).lean(),
    LeadApproval.find({ workspaceId, reportDate: date }).lean(),
    Assignment.find({ workspaceId, status: 'active' }).select('workerId username').lean(),
  ]);
  const workerIds = [...new Set(assignments.map((assignment) => assignment.workerId))];
  const workers = await User.find({ _id: { $in: workerIds }, role: 'worker', workspaceId }).select('name username').lean();
  const result = reports.map((report) => {
    const assignment = assignments.find((item) => item.username.toLowerCase() === report.normalizedUsername);
    const approval = approvals.find((item) => item.normalizedUsername === report.normalizedUsername);
    return {
      username: report.normalizedUsername,
      officialReportValue: report.reportValue,
      workerId: assignment?.workerId || null,
      workerName: workers.find((worker) => String(worker._id) === assignment?.workerId)?.name || null,
      approval: approval ? { approvedLeads: approval.approvedLeads, rejectedLeads: approval.rejectedLeads, adjustmentAmount: approval.adjustmentAmount, adjustmentReason: approval.adjustmentReason, reviewedAt: approval.reviewedAt } : null,
    };
  });
  return NextResponse.json({ date, rows: result });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Only an Admin can review payable leads.' }, { status: 403 });
  let body: { date?: unknown; workspaceId?: unknown; items?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const date = String(body.date || '');
  const requestedWorkspaceId = body.workspaceId ? String(body.workspaceId) : null;
  const workspaceId = scopedWorkspace(session.role, session.workspaceId, requestedWorkspaceId);
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  if (!workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 400 });
  if (!validDate(date)) return NextResponse.json({ message: 'Choose a valid report date.' }, { status: 400 });
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 500) return NextResponse.json({ message: 'Submit between 1 and 500 lead decisions.' }, { status: 400 });

  const items = body.items.map((value) => {
    const item = value as Record<string, unknown>;
    return {
      username: String(item.username || '').trim().toLowerCase(),
      approvedLeads: Number(item.approvedLeads),
      rejectedLeads: Number(item.rejectedLeads),
      adjustmentAmount: item.adjustmentAmount === undefined || item.adjustmentAmount === '' ? 0 : Number(item.adjustmentAmount),
      adjustmentReason: String(item.adjustmentReason || '').trim().slice(0, 500),
    };
  });
  if (items.some((item) => !item.username || item.username.length > 100 || !Number.isSafeInteger(item.approvedLeads) || item.approvedLeads < 0 || !Number.isSafeInteger(item.rejectedLeads) || item.rejectedLeads < 0 || !Number.isFinite(item.adjustmentAmount))) {
    return NextResponse.json({ message: 'Each item needs a username, whole non-negative approved/rejected counts, and a finite adjustment.' }, { status: 400 });
  }
  if (items.some((item) => item.adjustmentAmount !== 0 && !item.adjustmentReason)) return NextResponse.json({ message: 'A reason is required for every non-zero payment adjustment.' }, { status: 400 });
  if (new Set(items.map((item) => item.username)).size !== items.length) return NextResponse.json({ message: 'Duplicate usernames in the same review request are not allowed.' }, { status: 400 });

  await connectDB();
  const usernames = items.map((item) => item.username);
  const [reports, assignments] = await Promise.all([
    OfficialReport.find({ workspaceId, reportDate: date, normalizedUsername: { $in: usernames } }).lean(),
    Assignment.find({ workspaceId, status: 'active', username: { $in: usernames } }).lean(),
  ]);
  const reportByUsername = new Map(reports.map((report) => [report.normalizedUsername, report]));
  const assignmentByUsername = new Map(assignments.map((assignment) => [assignment.username.toLowerCase(), assignment]));
  const conflicts = items.filter((item) => !reportByUsername.has(item.username) || !assignmentByUsername.has(item.username) || item.approvedLeads + item.rejectedLeads > (reportByUsername.get(item.username)?.reportValue ?? -1));
  if (conflicts.length) return NextResponse.json({ message: 'Some rows lack an official report or active workspace assignment, or exceed the official report value.', conflicts: conflicts.map((item) => item.username) }, { status: 409 });

  const changes: { username: string; before: unknown; after: unknown }[] = [];
  for (const item of items) {
    const report = reportByUsername.get(item.username)!;
    const assignment = assignmentByUsername.get(item.username)!;
    const previous = await LeadApproval.findOne({ workspaceId, reportDate: date, normalizedUsername: item.username }).lean();
    const approval = await LeadApproval.findOneAndUpdate(
      { workspaceId, reportDate: date, normalizedUsername: item.username },
      { $set: { workspaceId, reportDate: date, normalizedUsername: item.username, workerId: assignment.workerId, officialReportValue: report.reportValue, approvedLeads: item.approvedLeads, rejectedLeads: item.rejectedLeads, adjustmentAmount: item.adjustmentAmount, adjustmentReason: item.adjustmentReason, reviewedBy: session.id, reviewedAt: new Date() } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
    changes.push({ username: item.username, before: previous ? { approvedLeads: previous.approvedLeads, rejectedLeads: previous.rejectedLeads, adjustmentAmount: previous.adjustmentAmount, adjustmentReason: previous.adjustmentReason } : null, after: { approvedLeads: approval!.approvedLeads, rejectedLeads: approval!.rejectedLeads, adjustmentAmount: approval!.adjustmentAmount, adjustmentReason: approval!.adjustmentReason } });
  }

  await AuditLog.create({ workspaceId, actorId: session.id, actorRole: session.role, action: 'lead_approvals.saved', resourceType: 'lead_approval_batch', details: { reportDate: date, changes } });
  return NextResponse.json({ success: true, saved: changes.length });
}
