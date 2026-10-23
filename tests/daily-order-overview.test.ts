import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  connectDB: vi.fn(),
  userFind: vi.fn(),
  orderFind: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.session }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({ User: { find: mocks.userFind }, UserOrder: { find: mocks.orderFind } }));

function query<T>(data: T) {
  const builder = {
    select: vi.fn(() => builder),
    sort: vi.fn(() => builder),
    lean: vi.fn().mockResolvedValue(data),
  };
  return builder;
}

async function getOverview(date = '2026-10-10', workspaceId = 'workspace-a') {
  const route = await import('../src/app/api/orders/daily-overview/route');
  return route.GET(new Request(`https://app.example.test/api/orders/daily-overview?date=${date}&workspaceId=${workspaceId}`) as never);
}

describe('daily Worker order overview API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.userFind.mockReturnValue(query([]));
    mocks.orderFind.mockReturnValue(query([]));
  });

  it('counts distinct active Workers and quantities across multiple orders', async () => {
    const workers = Array.from({ length: 20 }, (_, index) => ({
      _id: `worker-${index + 1}`, name: `Worker ${index + 1}`, username: `worker${index + 1}`, status: 'active',
    }));
    mocks.userFind.mockReturnValue(query(workers));
    const orders = Array.from({ length: 15 }, (_, index) => ({
      _id: `order-${index + 1}`, workspaceId: 'workspace-a', workerId: `worker-${index + 1}`,
      requestDate: new Date('2026-10-10T01:00:00.000Z'), requestedQuantity: 10, deliveredQuantity: 4,
      pendingQuantity: 6, status: 'partially_fulfilled',
    }));
    orders.push({ ...orders[0], _id: 'order-1-extra', requestedQuantity: 5, deliveredQuantity: 5, pendingQuantity: 0, status: 'fulfilled' });
    mocks.orderFind.mockReturnValue(query(orders));

    const response = await getOverview();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ eligibleWorkers: 20, orderedWorkers: 15, workersWithoutOrders: 5, totalOrdered: 155, totalFulfilled: 65, totalPending: 90 });
    expect(body.workers).toHaveLength(20);
    expect(body.workers.find((worker: { id: string }) => worker.id === 'worker-1')).toMatchObject({ ordered: 15, fulfilled: 9, pending: 6, orderStatus: 'ordered' });
    expect(mocks.userFind).toHaveBeenCalledWith({ workspaceId: 'workspace-a', role: 'worker', status: 'active' });
    expect(mocks.orderFind).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-a', workerId: { $in: workers.map((worker) => worker._id) },
      requestDate: { $gte: new Date('2026-10-09T18:00:00.000Z'), $lt: new Date('2026-10-10T18:00:00.000Z') },
    }));
  });

  it('excludes pending and blocked accounts from the active Worker denominator', async () => {
    mocks.userFind.mockReturnValue(query([{ _id: 'active', name: 'Active', username: 'active', status: 'active' }]));
    mocks.orderFind.mockReturnValue(query([]));
    const response = await getOverview();
    expect(await response.json()).toMatchObject({ eligibleWorkers: 1, orderedWorkers: 0, workersWithoutOrders: 1 });
    expect(mocks.userFind).toHaveBeenCalledWith({ workspaceId: 'workspace-a', role: 'worker', status: 'active' });
  });

  it('rejects an Admin request for another workspace before database access', async () => {
    const response = await getOverview('2026-10-10', 'workspace-b');
    expect(response.status).toBe(403);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });

  it('allows a Super Admin to inspect the explicitly requested workspace', async () => {
    mocks.session.mockResolvedValue({ id: 'owner', role: 'super-admin', workspaceId: 'owner-workspace' });
    const userQuery = query([]);
    mocks.userFind.mockReturnValue(userQuery);
    const response = await getOverview('2026-10-10', 'workspace-b');
    expect(response.status).toBe(200);
    expect(mocks.userFind).toHaveBeenCalledWith({ workspaceId: 'workspace-b', role: 'worker', status: 'active' });
  });

  it('rejects impossible dates and unauthenticated/non-admin roles', async () => {
    expect((await getOverview('2026-02-30')).status).toBe(400);
    mocks.session.mockResolvedValue({ id: 'worker', role: 'worker', workspaceId: 'workspace-a' });
    expect((await getOverview()).status).toBe(403);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });
});
