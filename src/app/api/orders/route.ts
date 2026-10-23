import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, User, UserOrder } from '@/lib/models';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });

  const requestedWorkspaceId = new URL(request.url).searchParams.get('workspaceId');
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) {
    return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  }
  if (session.role === 'worker' && !session.workspaceId) return NextResponse.json({ orders: [] });
  const workspaceId = session.role === 'worker' || session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (!workspaceId) return NextResponse.json({ message: 'Select a workspace.' }, { status: 400 });

  await connectDB();
  const filter = session.role === 'worker' ? { workspaceId, workerId: session.id } : { workspaceId };
  const orders = await UserOrder.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  const workerIds = [...new Set(orders.map((order) => order.workerId))];
  const workers = session.role === 'worker' ? [] : await User.find({ _id: { $in: workerIds }, role: 'worker', workspaceId }).select('name username').lean();
  return NextResponse.json({ orders: orders.map((order) => ({
    id: String(order._id),
    workerId: order.workerId,
    workerName: workers.find((worker) => String(worker._id) === order.workerId)?.name || null,
    requestedQuantity: order.requestedQuantity,
    deliveredQuantity: order.deliveredQuantity,
    pendingQuantity: order.pendingQuantity,
    status: order.status,
    requestDate: order.requestDate,
  })) });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'worker') return NextResponse.json({ message: 'Only workers can request usernames.' }, { status: 403 });
  if (!session.workspaceId) return NextResponse.json({ message: 'Your account is not assigned to a workspace.' }, { status: 409 });

  let body: { quantity?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Invalid JSON.' }, { status: 400 }); }
  const quantity = Number(body.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) {
    return NextResponse.json({ message: 'Quantity must be a whole number from 1 to 10,000.' }, { status: 400 });
  }

  await connectDB();
  let orderId = '';
  try {
    const databaseSession = await UserOrder.startSession();
    try {
      await databaseSession.withTransaction(async () => {
        const [order] = await UserOrder.create([{
          workspaceId: session.workspaceId,
          workerId: session.id,
          requestedQuantity: quantity,
          deliveredQuantity: 0,
          pendingQuantity: quantity,
          status: 'pending',
        }], { session: databaseSession });
        orderId = String(order._id);
        await AuditLog.create([{
          workspaceId: session.workspaceId,
          actorId: session.id,
          actorRole: session.role,
          action: 'order.requested',
          resourceType: 'user_order',
          resourceId: orderId,
          details: { quantity },
        }], { session: databaseSession });
      });
    } finally {
      await databaseSession.endSession();
    }
  } catch {
    return NextResponse.json({ message: 'Unable to save the order. Verify that MongoDB transactions are available.' }, { status: 500 });
  }
  if (!orderId) return NextResponse.json({ message: 'Order transaction did not return a result.' }, { status: 500 });
  return NextResponse.json({ success: true, order: { id: orderId, requestedQuantity: quantity, deliveredQuantity: 0, pendingQuantity: quantity, status: 'pending' } }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });

  let body: { orderId?: unknown; deliveredQuantity?: unknown; workspaceId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Invalid JSON.' }, { status: 400 }); }
  const orderId = String(body.orderId || '');
  const deliveredQuantity = Number(body.deliveredQuantity);
  const requestedWorkspaceId = String(body.workspaceId || '');
  if (!orderId || !Number.isSafeInteger(deliveredQuantity) || deliveredQuantity < 0) return NextResponse.json({ message: 'Provide a valid delivery quantity.' }, { status: 400 });
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (!workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 400 });

  await connectDB();
  type FulfillmentOutcome =
    | { type: 'not-found' }
    | { type: 'invalid-quantity' }
    | { type: 'unchanged'; order: Awaited<ReturnType<typeof UserOrder.findOne>> }
    | { type: 'updated'; order: Awaited<ReturnType<typeof UserOrder.findOne>> };
  let outcome: FulfillmentOutcome | undefined;
  try {
    const databaseSession = await UserOrder.startSession();
    try {
      outcome = await databaseSession.withTransaction(async () => {
        const order = await UserOrder.findOne({ _id: orderId, workspaceId }).session(databaseSession);
        if (!order) return { type: 'not-found' } as const;
        const previousDelivered = order.deliveredQuantity;
        if (deliveredQuantity < previousDelivered || deliveredQuantity > order.requestedQuantity) return { type: 'invalid-quantity' } as const;
        const deliveredNow = deliveredQuantity - previousDelivered;
        if (deliveredNow === 0) return { type: 'unchanged', order } as const;
        order.deliveredQuantity = deliveredQuantity;
        order.pendingQuantity = order.requestedQuantity - deliveredQuantity;
        order.status = order.pendingQuantity === 0 ? 'fulfilled' : deliveredQuantity > 0 ? 'partially_fulfilled' : 'pending';
        order.deliveryHistory.push({ quantity: deliveredNow, deliveredBy: session.id, deliveredAt: new Date(), cumulativeDelivered: deliveredQuantity });
        await order.save({ session: databaseSession });
        await AuditLog.create([{
          workspaceId,
          actorId: session.id,
          actorRole: session.role,
          action: 'order.fulfilled',
          resourceType: 'user_order',
          resourceId: orderId,
          details: { previousDelivered, deliveredNow, deliveredQuantity },
        }], { session: databaseSession });
        return { type: 'updated', order } as const;
      });
    } finally {
      await databaseSession.endSession();
    }
  } catch {
    return NextResponse.json({ message: 'Unable to update the order. Verify that MongoDB transactions are available.' }, { status: 500 });
  }
  if (!outcome || outcome.type === 'not-found') return NextResponse.json({ message: 'Order not found in this workspace.' }, { status: 404 });
  if (outcome.type === 'invalid-quantity') return NextResponse.json({ message: 'Delivered quantity must not decrease or exceed the requested quantity.' }, { status: 400 });
  const order = outcome.order;
  return NextResponse.json({ success: true, order: { id: orderId, requestedQuantity: order!.requestedQuantity, deliveredQuantity: order!.deliveredQuantity, pendingQuantity: order!.pendingQuantity, status: order!.status, ...(outcome.type === 'updated' ? { deliveryHistory: order!.deliveryHistory } : {}) } });
}
