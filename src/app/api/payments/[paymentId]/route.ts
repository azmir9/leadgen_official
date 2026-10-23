import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, Payment, PaymentAllocation } from '@/lib/models';

type Context = { params: Promise<{ paymentId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Only an Admin can update payment status.' }, { status: 403 });
  const { paymentId } = await context.params;
  let body: { status?: unknown; transactionReference?: unknown; paidAmount?: unknown; workspaceId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const status = String(body.status || '');
  const transactionReference = String(body.transactionReference || '').trim();
  const parsedPaidAmount = body.paidAmount === undefined || body.paidAmount === '' ? null : Number(body.paidAmount);
  const requestedPaidAmount = parsedPaidAmount === null ? null : Math.round((parsedPaidAmount + Number.EPSILON) * 100) / 100;
  const requestedWorkspaceId = body.workspaceId ? String(body.workspaceId) : null;
  if (session.role === 'admin' && !session.workspaceId) return NextResponse.json({ message: 'Your account is not assigned to a workspace.' }, { status: 403 });
  if (!['paid', 'void'].includes(status) || transactionReference.length > 100 || (requestedPaidAmount !== null && (!Number.isFinite(requestedPaidAmount) || requestedPaidAmount <= 0))) return NextResponse.json({ message: 'Choose paid or void and provide a valid amount and transaction reference.' }, { status: 400 });
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });

  await connectDB();
  const filter: Record<string, unknown> = { _id: paymentId };
  if (session.role === 'admin') filter.workspaceId = session.workspaceId;
  else if (requestedWorkspaceId) filter.workspaceId = requestedWorkspaceId;
  const existing = await Payment.findOne(filter).lean();
  if (!existing) return NextResponse.json({ message: 'Payment not found.' }, { status: 404 });
  if (!['cleared', 'partially_paid'].includes(existing.status)) return NextResponse.json({ message: 'Only unpaid or partially paid clearances can be updated.' }, { status: 409 });
  const previousPaidAmount = Math.round(((Number(existing.paidAmount) || 0) + Number.EPSILON) * 100) / 100;
  const remainingBalance = Math.round((existing.payableAmount - previousPaidAmount + Number.EPSILON) * 100) / 100;
  if (status === 'void' && previousPaidAmount > 0) return NextResponse.json({ message: 'A payment with recorded funds cannot be voided.' }, { status: 409 });
  const paidNow = status === 'paid' ? requestedPaidAmount ?? remainingBalance : 0;
  if (status === 'paid' && (paidNow <= 0 || paidNow > remainingBalance)) return NextResponse.json({ message: 'Payment amount must be greater than zero and no more than the remaining balance.' }, { status: 409 });
  const newPaidAmount = Math.round((previousPaidAmount + paidNow + Number.EPSILON) * 100) / 100;
  const newStatus = status === 'void' ? 'void' : newPaidAmount >= existing.payableAmount ? 'paid' : 'partially_paid';
  const newRemainingBalance = Math.max(0, Math.round((existing.payableAmount - newPaidAmount + Number.EPSILON) * 100) / 100);
  const paymentRecordedAt = new Date();

  const databaseSession = await Payment.startSession();
  let updated = false;
  try {
    await databaseSession.withTransaction(async () => {
      const result = await Payment.updateOne({
        _id: paymentId,
        workspaceId: existing.workspaceId,
        status: existing.status,
        ...(existing.paidAmount === undefined ? { paidAmount: { $exists: false } } : { paidAmount: previousPaidAmount }),
      }, {
        $set: {
          status: newStatus,
          paidAmount: newPaidAmount,
          ...(status === 'paid' && newStatus === 'paid' ? { paidAt: paymentRecordedAt } : {}),
          ...(status === 'paid' && transactionReference ? { transactionReference } : {}),
        },
        ...(status === 'paid' ? { $push: { paymentHistory: { amount: paidNow, transactionReference, recordedBy: session.id, recordedAt: paymentRecordedAt } } } : {}),
      }, { session: databaseSession });
      if (result.matchedCount !== 1) return;
      updated = true;
      if (newStatus === 'void') await PaymentAllocation.updateMany({ paymentId, status: 'active' }, { $set: { status: 'void' } }, { session: databaseSession });
      await AuditLog.create([{
        workspaceId: existing.workspaceId,
        actorId: session.id,
        actorRole: session.role,
        action: newStatus === 'void' ? 'payment.voided' : newStatus === 'partially_paid' ? 'payment.partially_paid' : 'payment.marked_paid',
        resourceType: 'payment',
        resourceId: paymentId,
        details: { previousStatus: existing.status, status: newStatus, previousPaidAmount, paidNow, paidAmount: newPaidAmount, remainingBalance: newRemainingBalance, transactionReference: status === 'paid' ? transactionReference : '' },
      }], { session: databaseSession });
    });
  } catch {
    return NextResponse.json({ message: 'Unable to update payment status.' }, { status: 500 });
  } finally {
    await databaseSession.endSession();
  }

  if (!updated) return NextResponse.json({ message: 'Payment status changed in another request. Refresh and try again.' }, { status: 409 });

  return NextResponse.json({ success: true, paymentId, status: newStatus, paidAmount: newPaidAmount, remainingBalance: newRemainingBalance });
}
