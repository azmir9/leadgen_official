import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: { id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' } as { id: string; role: string; workspaceId: string | null },
  orders: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  userFind: vi.fn(),
  orderFind: vi.fn(),
  assignmentFind: vi.fn(),
  getSessionFromRequest: vi.fn(),
  connectDB: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  User: { find: mocks.userFind },
  UserOrder: { find: mocks.orderFind },
  Assignment: { find: mocks.assignmentFind },
}));

function query<T>(value: T) {
  const builder = {
    sort: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    select: vi.fn(() => builder),
    lean: vi.fn(async () => value),
  };
  return builder;
}

function request(path: string) {
  return new Request(`https://app.example.test/api/${path}`) as never;
}

function loadRoute(routeName: 'orders' | 'assignments') {
  return routeName === 'orders'
    ? import('../src/app/api/orders/route')
    : import('../src/app/api/assignments/route');
}

describe('related worker lookup isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.session = { id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' };
    mocks.orders = [{ _id: 'order-1', workerId: 'worker-a', requestedQuantity: 5, deliveredQuantity: 0, pendingQuantity: 5, status: 'pending' }];
    mocks.assignments = [{ _id: 'assignment-1', workerId: 'worker-a', username: 'lead-a', status: 'active' }];
    mocks.users = [
      { _id: 'worker-a', name: 'Worker A', username: 'worker-a', role: 'worker', workspaceId: 'workspace-a' },
      { _id: 'worker-b', name: 'Worker B', username: 'worker-b', role: 'worker', workspaceId: 'workspace-b' },
      { _id: 'admin-a', name: 'Admin A', username: 'admin-a', role: 'admin', workspaceId: 'workspace-a' },
    ];
    mocks.getSessionFromRequest.mockImplementation(async () => ({ ...mocks.session }));
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.orderFind.mockImplementation(() => query(mocks.orders));
    mocks.assignmentFind.mockImplementation(() => query(mocks.assignments));
    mocks.userFind.mockImplementation((filter: { _id: { $in: string[] }; role: string; workspaceId: string }) => query(
      mocks.users.filter((user) => filter._id.$in.includes(String(user._id))
        && user.role === filter.role
        && user.workspaceId === filter.workspaceId),
    ));
  });

  it.each([
    ['orders', 'orders'],
    ['assignments', 'assignments'],
  ] as const)('%s returns the name for a same-Workspace Worker and scopes the lookup', async (routeName, responseKey) => {
    const route = await loadRoute(routeName);
    const response = await route.GET(request(routeName));
    const body = await response.json();

    expect(body[responseKey][0].workerName).toBe('Worker A');
    expect(mocks.userFind).toHaveBeenCalledWith(expect.objectContaining({
      role: 'worker',
      workspaceId: 'workspace-a',
      _id: { $in: ['worker-a'] },
    }));
  });

  it.each([
    ['orders', 'orders'],
    ['assignments', 'assignments'],
  ] as const)('%s hides names for wrong-Workspace, wrong-role, and missing related users', async (routeName, responseKey) => {
    if (routeName === 'orders') {
      mocks.orders = ['worker-b', 'admin-a', 'missing-worker'].map((workerId, index) => ({
        _id: `order-${index}`, workerId, requestedQuantity: 1, deliveredQuantity: 0, pendingQuantity: 1, status: 'pending',
      }));
    } else {
      mocks.assignments = ['worker-b', 'admin-a', 'missing-worker'].map((workerId, index) => ({
        _id: `assignment-${index}`, workerId, username: `lead-${index}`, status: 'active',
      }));
    }

    const route = await loadRoute(routeName);
    const response = await route.GET(request(routeName));
    const body = await response.json();

    expect(body[responseKey].map((item: { workerName: string | null }) => item.workerName)).toEqual([null, null, null]);
    expect(mocks.userFind).toHaveBeenCalledWith(expect.objectContaining({ role: 'worker', workspaceId: 'workspace-a' }));
  });

  it.each([
    ['orders', 'orders'],
    ['assignments', 'assignments'],
  ] as const)('preserves Super Admin access to a selected Workspace in %s', async (routeName, responseKey) => {
    mocks.session = { id: 'super-admin', role: 'super-admin', workspaceId: null };
    const route = await loadRoute(routeName);
    const response = await route.GET(request(`${routeName}?workspaceId=workspace-b`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[responseKey]).toBeDefined();
    expect(mocks.userFind).toHaveBeenCalledWith(expect.objectContaining({ role: 'worker', workspaceId: 'workspace-b' }));
    expect(mocks.userFind.mock.calls.at(-1)?.[0].workspaceId).not.toBe('workspace-a');
  });
});
