import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, DailyRate } from '@/lib/models';

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });
  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get('workspaceId');
  if (session.role === 'admin' && !session.workspaceId) return NextResponse.json({ message: 'Your account is not assigned to a workspace.' }, { status: 403 });
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if ((from && !validDate(from)) || (to && !validDate(to))) return NextResponse.json({ message: 'Dates must use YYYY-MM-DD.' }, { status: 400 });

  await connectDB();
  const filter: Record<string, unknown> = workspaceId ? { workspaceId } : {};
  if (from || to) filter.effectiveDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rates = await DailyRate.find(filter).sort({ effectiveDate: -1 }).limit(500).lean();
  return NextResponse.json({ rates: rates.map((rate) => ({ id: String(rate._id), effectiveDate: rate.effectiveDate, ratePerLead: rate.ratePerLead, currency: rate.currency, setBy: rate.setBy, updatedAt: rate.updatedAt })) });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Only an Admin can set workspace rates.' }, { status: 403 });
  let body: { date?: unknown; ratePerLead?: unknown; currency?: unknown; workspaceId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const date = String(body.date || '');
  const ratePerLead = Number(body.ratePerLead);
  const currency = String(body.currency || 'BDT').trim().toUpperCase();
  const requestedWorkspaceId = body.workspaceId ? String(body.workspaceId) : null;
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (!workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 400 });
  if (!validDate(date) || !Number.isFinite(ratePerLead) || ratePerLead < 0 || ratePerLead > 1_000_000 || !/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json({ message: 'Enter a valid effective date, non-negative rate, and ISO 4217 currency code.' }, { status: 400 });
  }

  await connectDB();
  const previous = await DailyRate.findOne({ workspaceId, effectiveDate: date }).lean();
  const rate = await DailyRate.findOneAndUpdate(
    { workspaceId, effectiveDate: date },
    { $set: { workspaceId, effectiveDate: date, ratePerLead, currency, setBy: session.id } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  await AuditLog.create({
    workspaceId,
    actorId: session.id,
    actorRole: session.role,
    action: previous ? 'daily_rate.corrected' : 'daily_rate.created',
    resourceType: 'daily_rate',
    resourceId: String(rate?._id || ''),
    details: { effectiveDate: date, before: previous ? { ratePerLead: previous.ratePerLead, currency: previous.currency } : null, after: { ratePerLead, currency } },
  });
  return NextResponse.json({ success: true, rate: { id: String(rate?._id), effectiveDate: date, ratePerLead, currency } }, { status: previous ? 200 : 201 });
}
