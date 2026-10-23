import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, Payment, PaymentAllocation, User } from '@/lib/models';
import { buildClearancePreview, type ClearanceLine } from '@/lib/payments';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });
  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get('workspaceId');
  if (session.role === 'admin' && !session.workspaceId) return NextResponse.json({ message: 'Your account is not assigned to a workspace.' }, { status: 403 });
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  if (session.role === 'worker' && !session.workspaceId) return NextResponse.json({ payments: [], total: 0 });
  const workspaceId = session.role === 'worker' || session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page') || 1)));
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  if (!Number.isInteger(page) || !Number.isInteger(limit)) return NextResponse.json({ message: 'Invalid pagination.' }, { status: 400 });

  await connectDB();
  const filter: Record<string, unknown> = workspaceId ? { workspaceId } : {};
  if (session.role === 'worker') filter.workerId = session.id;
  else if (url.searchParams.has('workerId')) filter.workerId = url.searchParams.get('workerId');
  const status = url.searchParams.get('status');
  if (status) {
    if (!['cleared', 'partially_paid', 'paid', 'void'].includes(status)) return NextResponse.json({ message: 'Invalid payment status.' }, { status: 400 });
    filter.status = status;
  }
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from || to) filter['allocations.reportDate'] = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ finalizedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);
  const workerIds = session.role === 'worker' ? [] : [...new Set(payments.map((payment) => payment.workerId))];
  const workers = workerIds.length ? await User.find({ _id: { $in: workerIds }, role: 'worker', ...(workspaceId ? { workspaceId } : {}) }).select('name username').lean() : [];
  return NextResponse.json({
    payments: payments.map((payment) => ({
      id: String(payment._id),
      workerId: payment.workerId,
      workerName: workers.find((worker) => String(worker._id) === payment.workerId)?.name || null,
      paymentMethod: payment.paymentMethod,
      accountSnapshot: payment.accountSnapshot,
      transactionReference: payment.transactionReference,
      currency: payment.currency,
      grossAmount: payment.grossAmount,
      adjustmentTotal: payment.adjustmentTotal,
      payableAmount: payment.payableAmount,
      paidAmount: Number(payment.paidAmount) || 0,
      remainingBalance: Math.max(0, Math.round((payment.payableAmount - (Number(payment.paidAmount) || 0) + Number.EPSILON) * 100) / 100),
      allocations: payment.allocations,
      paymentHistory: (payment.paymentHistory || []).map((entry: { amount: number; transactionReference: string; recordedAt: Date }) => ({ amount: entry.amount, transactionReference: entry.transactionReference, recordedAt: entry.recordedAt })),
      status: payment.status,
      finalizedAt: payment.finalizedAt,
      paidAt: payment.paidAt,
    })),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Only an Admin can clear payments.' }, { status: 403 });
  let body: { workerId?: unknown; reportDates?: unknown; paymentMethod?: unknown; transactionReference?: unknown; workspaceId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const workerId = String(body.workerId || '');
  const paymentMethod = String(body.paymentMethod || '');
  const requestedWorkspaceId = body.workspaceId ? String(body.workspaceId) : null;
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (!workspaceId || !workerId || !Array.isArray(body.reportDates) || body.reportDates.some((date) => typeof date !== 'string')) return NextResponse.json({ message: 'Workspace, worker, and report dates are required.' }, { status: 400 });
  if (!['bKash', 'Nagad', 'Rocket', 'Bank Transfer', 'Cash'].includes(paymentMethod)) return NextResponse.json({ message: 'Choose a supported payment method.' }, { status: 400 });
  const transactionReference = String(body.transactionReference || '').trim();
  if (transactionReference.length > 100) return NextResponse.json({ message: 'Transaction reference is too long.' }, { status: 400 });

  await connectDB();
  const preview = await buildClearancePreview(workspaceId, workerId, body.reportDates as string[]);
  if ('error' in preview) return NextResponse.json(preview, { status: 409 });
  if (preview.missing.length || preview.alreadyPaid.length || !preview.lines.length || preview.payableAmount <= 0) {
    return NextResponse.json({ message: 'Some selected dates have no lead approval, are already allocated, or have no payable records.', missing: preview.missing, alreadyPaid: preview.alreadyPaid }, { status: 409 });
  }
  const accountSnapshot = paymentMethod === 'Cash' ? 'Cash' : String(preview.worker.paymentAccounts[paymentMethod] || '').trim();
  if (!accountSnapshot) return NextResponse.json({ message: `Worker has no ${paymentMethod} account saved in their profile.` }, { status: 409 });

  const databaseSession = await Payment.startSession();
  let paymentId = '';
  let transactionConflict = '';
  let finalized: { payableAmount: number; currency: string; allocations: ClearanceLine[] } | null = null;
  try {
    await databaseSession.withTransaction(async () => {
      const currentPreview = await buildClearancePreview(workspaceId, workerId, body.reportDates as string[], databaseSession);
      if ('error' in currentPreview && currentPreview.error) {
        transactionConflict = currentPreview.error;
        return;
      }
      if (currentPreview.missing.length || currentPreview.alreadyPaid.length || !currentPreview.lines.length || currentPreview.payableAmount <= 0) {
        transactionConflict = 'Selected dates changed or are no longer eligible. Refresh and preview again.';
        return;
      }
      const currentAccountSnapshot = paymentMethod === 'Cash' ? 'Cash' : String(currentPreview.worker.paymentAccounts[paymentMethod] || '').trim();
      if (!currentAccountSnapshot) {
        transactionConflict = `Worker has no ${paymentMethod} account saved in their profile.`;
        return;
      }
      const [payment] = await Payment.create([{
        workspaceId,
        workerId,
        paymentMethod,
        accountSnapshot: currentAccountSnapshot,
        transactionReference,
        currency: currentPreview.currency,
        grossAmount: currentPreview.grossAmount,
        adjustmentTotal: currentPreview.adjustmentTotal,
        payableAmount: currentPreview.payableAmount,
        paidAmount: 0,
        allocations: currentPreview.lines,
        status: 'cleared',
        clearedBy: session.id,
        finalizedAt: new Date(),
      }], { session: databaseSession });
      paymentId = String(payment._id);
      finalized = { payableAmount: currentPreview.payableAmount, currency: currentPreview.currency, allocations: currentPreview.lines };
      await PaymentAllocation.insertMany(currentPreview.lines.map((line) => ({ workspaceId, workerId, reportDate: line.reportDate, paymentId, createdBy: session.id, status: 'active' })), { session: databaseSession });
      await AuditLog.create([{
        workspaceId,
        actorId: session.id,
        actorRole: session.role,
        action: 'payment.cleared',
        resourceType: 'payment',
        resourceId: paymentId,
        details: { workerId, paymentMethod, payableAmount: currentPreview.payableAmount, allocations: currentPreview.lines },
      }], { session: databaseSession });
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      return NextResponse.json({ message: 'At least one selected date was allocated by another payment. Refresh and preview again.' }, { status: 409 });
    }
    return NextResponse.json({ message: 'Payment could not be finalized. Verify that MongoDB transactions are available.' }, { status: 500 });
  } finally {
    await databaseSession.endSession();
  }

  if (transactionConflict) return NextResponse.json({ message: transactionConflict }, { status: 409 });
  if (!paymentId || !finalized) return NextResponse.json({ message: 'Payment transaction did not return a result.' }, { status: 500 });

  return NextResponse.json({ success: true, paymentId, status: 'cleared', ...(finalized as { payableAmount: number; currency: string; allocations: ClearanceLine[] }) }, { status: 201 });
}
