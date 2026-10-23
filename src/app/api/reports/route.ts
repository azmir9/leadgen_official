import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { Assignment, AuditLog, OfficialReport, OfficialReportHistory } from '@/lib/models';

type ParsedRow = { line: number; username: string; normalizedUsername: string; reportValue: number };

function isValidReportDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseReportRows(input: string) {
  const rows: ParsedRow[] = [];
  const invalid: { line: number; input: string; reason: string }[] = [];
  const duplicates: { line: number; username: string }[] = [];
  const seen = new Set<string>();

  input.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const value = raw.trim();
    if (!value) return;
    const match = value.match(/^(.+?)(?:\t+|\s{2,}|\s+)(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      invalid.push({ line, input: raw, reason: 'Expected username and numeric report value.' });
      return;
    }
    const username = match[1].trim();
    const reportValue = Number(match[2]);
    if (!username || username.length > 100 || !Number.isFinite(reportValue) || reportValue < 0) {
      invalid.push({ line, input: raw, reason: 'Username or non-negative numeric value is invalid.' });
      return;
    }
    const normalizedUsername = username.toLowerCase();
    if (seen.has(normalizedUsername)) {
      duplicates.push({ line, username });
      return;
    }
    seen.add(normalizedUsername);
    rows.push({ line, username, normalizedUsername, reportValue });
  });

  return { rows, invalid, duplicates };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });
  const url = new URL(request.url);
  const reportDate = url.searchParams.get('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  if (!isValidReportDate(reportDate)) return NextResponse.json({ message: 'Date must be a valid YYYY-MM-DD date.' }, { status: 400 });
  const requestedWorkspaceId = url.searchParams.get('workspaceId');
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  if (session.role === 'worker' && !session.workspaceId) return NextResponse.json({ date: reportDate, reports: [], total: 0 });
  const workspaceId = session.role === 'worker' || session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (!workspaceId) return NextResponse.json({ message: 'Select a workspace.' }, { status: 400 });

  await connectDB();
  const filter: Record<string, unknown> = { workspaceId, reportDate };
  let displayedReports: { username: string; reportValue: number | null }[] = [];
  let reportTotal = 0;
  let history: Awaited<ReturnType<typeof OfficialReportHistory.find>> | undefined;
  if (session.role === 'worker') {
    const databaseSession = await OfficialReport.startSession();
    try {
      await databaseSession.withTransaction(async () => {
        const assignments = await Assignment.find({ workspaceId, workerId: session.id, status: 'active' })
          .select('username').session(databaseSession).lean();
        const assignedUsernames = [...new Set(assignments.map((assignment) => String(assignment.username).toLowerCase()))].sort();
        const reports = assignedUsernames.length
          ? await OfficialReport.find({ workspaceId, reportDate, normalizedUsername: { $in: assignedUsernames } })
            .sort({ normalizedUsername: 1 }).session(databaseSession).lean()
          : [];
        const reportsByUsername = new Map(reports.map((report) => [report.normalizedUsername, report.reportValue]));
        displayedReports = assignedUsernames.map((username) => ({ username, reportValue: reportsByUsername.get(username) ?? null }));
        reportTotal = displayedReports.reduce((sum, report) => sum + (report.reportValue ?? 0), 0);
      });
    } finally {
      await databaseSession.endSession();
    }
  } else {
    const reports = await OfficialReport.find(filter).sort({ normalizedUsername: 1 }).lean();
    displayedReports = reports.map((report) => ({ username: report.normalizedUsername, reportValue: report.reportValue }));
    reportTotal = displayedReports.reduce((sum, report) => sum + (report.reportValue ?? 0), 0);
    history = url.searchParams.get('history') === 'true'
      ? await OfficialReportHistory.find({ workspaceId, reportDate }).sort({ changedAt: -1 }).limit(1000).lean()
      : undefined;
  }
  return NextResponse.json({
    date: reportDate,
    reports: displayedReports,
    total: reportTotal,
    ...(history ? { history: history.map((entry) => ({ id: String(entry._id), username: entry.normalizedUsername, previousValue: entry.previousValue, nextValue: entry.nextValue, changedBy: entry.changedBy, changedAt: entry.changedAt })) } : {}),
  });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Only an Admin can import official reports.' }, { status: 403 });
  let body: { date?: unknown; data?: unknown; action?: unknown; overwrite?: unknown; workspaceId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Invalid JSON.' }, { status: 400 }); }
  const reportDate = String(body.date || '');
  const action = String(body.action || 'preview');
  const input = String(body.data || '');
  const requestedWorkspaceId = String(body.workspaceId || '');
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  if (!workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 400 });
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(reportDate) ? new Date(`${reportDate}T00:00:00.000Z`) : null;
  if (!selectedDate || Number.isNaN(selectedDate.getTime()) || selectedDate.toISOString().slice(0, 10) !== reportDate) return NextResponse.json({ message: 'Choose a valid report date.' }, { status: 400 });
  if (!input.trim() || input.length > 1_000_000) return NextResponse.json({ message: 'Paste report rows (maximum 1 MB).' }, { status: 400 });
  if (!['preview', 'import'].includes(action)) return NextResponse.json({ message: 'Action must be preview or import.' }, { status: 400 });

  await connectDB();
  const parsed = parseReportRows(input);
  const usernames = parsed.rows.map((row) => row.normalizedUsername);
  const [existing, assignments] = await Promise.all([
    usernames.length ? OfficialReport.find({ workspaceId, reportDate, normalizedUsername: { $in: usernames } }).select('_id normalizedUsername reportValue').lean() : [],
    usernames.length ? Assignment.find({ workspaceId, status: 'active', username: { $in: usernames } }).select('username').lean() : [],
  ]);
  const existingByUsername = new Map(existing.map((report) => [report.normalizedUsername, { id: String(report._id), value: report.reportValue }]));
  const assigned = new Set(assignments.map((assignment) => assignment.username.toLowerCase()));
  const rows = parsed.rows.map((row) => ({
    ...row,
    existingValue: existingByUsername.get(row.normalizedUsername)?.value ?? null,
    unassigned: !assigned.has(row.normalizedUsername),
  }));
  const eligibleRows = rows.filter((row) => !row.unassigned);
  const newCount = eligibleRows.filter((row) => row.existingValue === null).length;
  const updateCount = eligibleRows.filter((row) => row.existingValue !== null).length;
  const skippedUnassigned = rows.filter((row) => row.unassigned).length;
  const summary = { new: newCount, updates: updateCount, invalid: parsed.invalid.length, duplicates: parsed.duplicates.length, unassigned: skippedUnassigned, skippedUnassigned };
  if (action === 'preview') return NextResponse.json({ rows, invalid: parsed.invalid, duplicates: parsed.duplicates, summary });

  const databaseSession = await OfficialReport.startSession();
  let outcome:
    | { type: 'confirmation'; rows: typeof rows; summary: typeof summary }
    | { type: 'empty'; skipped: number; invalid: number; skippedUnassigned: number }
    | { type: 'imported'; inserted: number; updated: number; skipped: number; invalid: number; skippedUnassigned: number };
  try {
    outcome = await databaseSession.withTransaction(async () => {
      const [currentExisting, currentAssignments] = await Promise.all([
        usernames.length
          ? OfficialReport.find({ workspaceId, reportDate, normalizedUsername: { $in: usernames } }).select('_id normalizedUsername reportValue').session(databaseSession).lean()
          : [],
        usernames.length
          ? Assignment.find({ workspaceId, status: 'active', username: { $in: usernames } }).select('username').session(databaseSession).lean()
          : [],
      ]);
      const currentExistingByUsername = new Map(currentExisting.map((report) => [report.normalizedUsername, { id: String(report._id), value: report.reportValue }]));
      const currentlyAssigned = new Set(currentAssignments.map((assignment) => assignment.username.toLowerCase()));
      const currentRows = parsed.rows.map((row) => ({
        ...row,
        existingValue: currentExistingByUsername.get(row.normalizedUsername)?.value ?? null,
        unassigned: !currentlyAssigned.has(row.normalizedUsername),
      }));
      const eligibleRows = currentRows.filter((row) => !row.unassigned);
      const skippedCount = currentRows.filter((row) => row.unassigned).length;
      const currentNewCount = eligibleRows.filter((row) => row.existingValue === null).length;
      const currentUpdateCount = eligibleRows.filter((row) => row.existingValue !== null).length;
      const currentSummary = {
        new: currentNewCount,
        updates: currentUpdateCount,
        invalid: parsed.invalid.length,
        duplicates: parsed.duplicates.length,
        unassigned: skippedCount,
        skippedUnassigned: skippedCount,
      };

      if (!eligibleRows.length) {
        return { type: 'empty', skipped: parsed.duplicates.length, invalid: parsed.invalid.length, skippedUnassigned: skippedCount } as const;
      }
      if (currentUpdateCount && body.overwrite !== true) {
        return { type: 'confirmation', rows: currentRows, summary: currentSummary } as const;
      }

      let inserted = 0;
      let updated = 0;
      for (const row of eligibleRows) {
        if (row.existingValue === null) {
          await OfficialReport.create([{
            workspaceId, reportDate, normalizedUsername: row.normalizedUsername, reportValue: row.reportValue, uploadedBy: session.id,
          }], { session: databaseSession });
          inserted += 1;
        } else {
          const current = currentExistingByUsername.get(row.normalizedUsername);
          if (!current) throw new Error('Report changed while importing.');
          if (current.value === row.reportValue) continue;
          await OfficialReportHistory.create([{
            workspaceId,
            reportId: current.id,
            reportDate,
            normalizedUsername: row.normalizedUsername,
            previousValue: current.value,
            nextValue: row.reportValue,
            changedBy: session.id,
            changedAt: new Date(),
          }], { session: databaseSession });
          const update = await OfficialReport.updateOne(
            { _id: current.id, workspaceId, reportDate, normalizedUsername: row.normalizedUsername, reportValue: current.value },
            { $set: { reportValue: row.reportValue, uploadedBy: session.id } },
            { session: databaseSession },
          );
          if (update.modifiedCount !== 1) throw new Error('Report changed while importing.');
          updated += 1;
        }
      }

      await AuditLog.create([{
        workspaceId,
        actorId: session.id,
        actorRole: session.role,
        action: 'official_reports.imported',
        resourceType: 'official_report_batch',
        details: {
          reportDate,
          inserted,
          updated,
          skipped: parsed.duplicates.length,
          invalid: parsed.invalid.length,
          skippedUnassigned: skippedCount,
          corrections: eligibleRows.filter((row) => row.existingValue !== null && row.existingValue !== row.reportValue).map((row) => ({
            username: row.normalizedUsername,
            before: row.existingValue,
            after: row.reportValue,
          })),
        },
      }], { session: databaseSession });

      return { type: 'imported', inserted, updated, skipped: parsed.duplicates.length, invalid: parsed.invalid.length, skippedUnassigned: skippedCount } as const;
    });
  } finally {
    await databaseSession.endSession();
  }

  if (!outcome) throw new Error('Report import transaction did not return an outcome.');
  if (outcome.type === 'confirmation') {
    return NextResponse.json({
      message: 'Existing reports need explicit overwrite confirmation.', requiresOverwriteConfirmation: true,
      rows: outcome.rows, invalid: parsed.invalid, duplicates: parsed.duplicates, summary: outcome.summary,
    }, { status: 409 });
  }
  if (outcome.type === 'empty') {
    return NextResponse.json({
      message: outcome.skippedUnassigned ? 'No assigned report rows were eligible for import.' : 'No valid report rows to import.',
      inserted: 0, updated: 0, skipped: outcome.skipped, invalid: outcome.invalid, skippedUnassigned: outcome.skippedUnassigned,
    }, { status: 400 });
  }
  return NextResponse.json({ success: true, ...outcome });
}
