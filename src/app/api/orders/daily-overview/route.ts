import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { User, UserOrder } from '@/lib/models';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BUSINESS_DAY_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getDhakaDayRange(date: string) {
  if (!DATE_PATTERN.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const start = new Date(utcMidnight - BUSINESS_DAY_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) {
    return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const date = url.searchParams.get('date') || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  const range = getDhakaDayRange(date);
  if (!range) return NextResponse.json({ message: 'Date must be a valid YYYY-MM-DD business date.' }, { status: 400 });

  const requestedWorkspaceId = url.searchParams.get('workspaceId');
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) {
    return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  }
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId || session.workspaceId;
  if (!workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 400 });

  await connectDB();
  const workers = await User.find({ workspaceId, role: 'worker', status: 'active' })
    .select('_id name username status')
    .sort({ name: 1, username: 1 })
    .lean();
  const workerIds = workers.map((worker) => String(worker._id));
  const orders = workerIds.length
    ? await UserOrder.find({ workspaceId, workerId: { $in: workerIds }, requestDate: { $gte: range.start, $lt: range.end } })
      .sort({ requestDate: 1, createdAt: 1 })
      .lean()
    : [];

  const ordersByWorker = new Map<string, typeof orders>();
  for (const order of orders) ordersByWorker.set(order.workerId, [...(ordersByWorker.get(order.workerId) || []), order]);

  const workerSummaries = workers.map((worker) => {
    const workerOrders = ordersByWorker.get(String(worker._id)) || [];
    const quantities = workerOrders.reduce((sum, order) => {
      const requested = Math.max(0, Number(order.requestedQuantity) || 0);
      const fulfilled = Math.min(requested, Math.max(0, Number(order.deliveredQuantity) || 0));
      sum.ordered += requested;
      sum.fulfilled += fulfilled;
      sum.pending += Math.max(0, requested - fulfilled);
      return sum;
    }, { ordered: 0, fulfilled: 0, pending: 0 });
    return {
      id: String(worker._id), name: worker.name, username: worker.username, status: worker.status,
      orderStatus: workerOrders.length ? 'ordered' : 'no-order',
      ...quantities,
      orders: workerOrders.map((order) => {
        const requestedQuantity = Math.max(0, Number(order.requestedQuantity) || 0);
        const deliveredQuantity = Math.min(requestedQuantity, Math.max(0, Number(order.deliveredQuantity) || 0));
        return {
          id: String(order._id), requestedQuantity, deliveredQuantity,
          pendingQuantity: Math.max(0, requestedQuantity - deliveredQuantity),
          status: order.status, requestDate: order.requestDate,
        };
      }),
    };
  });

  const totals = workerSummaries.reduce((sum, worker) => {
    if (worker.orders.length) sum.orderedWorkers += 1;
    sum.ordered += worker.ordered;
    sum.fulfilled += worker.fulfilled;
    sum.pending += worker.pending;
    return sum;
  }, { orderedWorkers: 0, ordered: 0, fulfilled: 0, pending: 0 });

  return NextResponse.json({
    date, workspaceId, eligibleWorkers: workers.length, orderedWorkers: totals.orderedWorkers,
    workersWithoutOrders: workers.length - totals.orderedWorkers,
    totalOrdered: totals.ordered, totalFulfilled: totals.fulfilled, totalPending: totals.pending,
    workers: workerSummaries,
  });
}
