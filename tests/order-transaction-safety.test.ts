import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: { order: null as Record<string, unknown> | null, auditLogs: [] as Record<string, unknown>[], failOrderWrite: false, failAudit: false },
  session: { withTransaction: vi.fn(), endSession: vi.fn() },
  getSessionFromRequest: vi.fn(),
  connectDB: vi.fn(),
  orderCreate: vi.fn(),
  orderFindOne: vi.fn(),
  orderSave: vi.fn(),
  orderStartSession: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/csrf', () => ({ isSameOriginRequest: vi.fn(() => true) }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  User: { find: vi.fn() },
  UserOrder: { create: mocks.orderCreate, findOne: mocks.orderFindOne, startSession: mocks.orderStartSession },
  AuditLog: { create: mocks.auditCreate },
}));

function request(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  return new Request('https://app.example.test/api/orders', {
    method,
    headers: { 'content-type': 'application/json', origin: 'https://app.example.test' },
    body: JSON.stringify(body),
  }) as never;
}

function orderDocument(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'order-a',
    workspaceId: 'workspace-a',
    workerId: 'worker-a',
    requestedQuantity: 10,
    deliveredQuantity: 0,
    pendingQuantity: 10,
    status: 'pending',
    deliveryHistory: [] as Record<string, unknown>[],
    ...overrides,
  };
}

describe('order and audit transaction safety', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.state.order = null;
    mocks.state.auditLogs = [];
    mocks.state.failOrderWrite = false;
    mocks.state.failAudit = false;
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'worker-a', role: 'worker', workspaceId: 'workspace-a' });
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.orderStartSession.mockResolvedValue(mocks.session);
    mocks.session.withTransaction.mockImplementation(async (callback: () => Promise<unknown>) => {
      const oldOrder = mocks.state.order ? structuredClone(mocks.state.order) : null;
      const oldAuditLogs = structuredClone(mocks.state.auditLogs);
      try {
        return await callback();
      } catch (error) {
        mocks.state.order = oldOrder;
        mocks.state.auditLogs = oldAuditLogs;
        throw error;
      }
    });
    mocks.orderCreate.mockImplementation(async (documents: Record<string, unknown>[], _options: { session: unknown }) => {
      void _options;
      if (mocks.state.failOrderWrite) throw new Error('mock order create failure');
      const created = { ...documents[0], _id: 'order-created', deliveryHistory: [] };
      mocks.state.order = created;
      return [created];
    });
    mocks.orderFindOne.mockImplementation((filter: Record<string, unknown>) => ({
      session: vi.fn(async () => {
        const stored = mocks.state.order;
        if (!stored || stored._id !== filter._id || stored.workspaceId !== filter.workspaceId) return null;
        const working = { ...stored, deliveryHistory: [...stored.deliveryHistory as Record<string, unknown>[]] } as Record<string, unknown>;
        working.save = async (options: { session: unknown }) => {
          mocks.orderSave(options);
          if (mocks.state.failOrderWrite) throw new Error('mock order save failure');
          const persisted = { ...working };
          delete persisted.save;
          mocks.state.order = { ...persisted, deliveryHistory: [...working.deliveryHistory as Record<string, unknown>[]] };
        };
        return working;
      }),
    }));
    mocks.auditCreate.mockImplementation(async (documents: Record<string, unknown>[]) => {
      if (mocks.state.failAudit) throw new Error('mock audit create failure');
      mocks.state.auditLogs.push(...documents);
      return documents;
    });
  });

  it('creates an order and audit entry using the same session', async () => {
    const route = await import('../src/app/api/orders/route');
    const response = await route.POST(request('POST', { quantity: 8 }));

    expect(response.status).toBe(201);
    expect(mocks.orderCreate.mock.calls[0][1]).toEqual({ session: mocks.session });
    expect(mocks.auditCreate.mock.calls[0][1]).toEqual({ session: mocks.session });
    expect(mocks.state.order).toMatchObject({ workerId: 'worker-a', workspaceId: 'workspace-a', requestedQuantity: 8 });
    expect(mocks.state.auditLogs).toHaveLength(1);
  });

  it('does not persist an order or report success when its audit write fails', async () => {
    mocks.state.failAudit = true;
    const route = await import('../src/app/api/orders/route');

    const response = await route.POST(request('POST', { quantity: 8 }));

    expect(response.status).toBe(500);
    expect(mocks.state.order).toBeNull();
    expect(mocks.state.auditLogs).toHaveLength(0);
  });

  it('does not write an audit entry or report success when order creation fails', async () => {
    mocks.state.failOrderWrite = true;
    const route = await import('../src/app/api/orders/route');

    const response = await route.POST(request('POST', { quantity: 8 }));

    expect(response.status).toBe(500);
    expect(mocks.state.order).toBeNull();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('updates fulfillment and writes its audit in the same transaction session', async () => {
    mocks.state.order = orderDocument();
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    const route = await import('../src/app/api/orders/route');

    const response = await route.PATCH(request('PATCH', { orderId: 'order-a', deliveredQuantity: 4 }));

    expect(response.status).toBe(200);
    expect(mocks.orderSave).toHaveBeenCalledWith({ session: mocks.session });
    expect(mocks.auditCreate.mock.calls[0][1]).toEqual({ session: mocks.session });
    expect(mocks.state.auditLogs).toHaveLength(1);
  });

  it('rolls back fulfillment and audit when audit write fails', async () => {
    const existing = orderDocument();
    mocks.state.order = existing;
    mocks.state.failAudit = true;
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    const route = await import('../src/app/api/orders/route');

    const response = await route.PATCH(request('PATCH', { orderId: 'order-a', deliveredQuantity: 4 }));

    expect(response.status).toBe(500);
    expect(mocks.state.order).toMatchObject({ deliveredQuantity: 0, pendingQuantity: 10, status: 'pending' });
    expect(mocks.state.auditLogs).toHaveLength(0);
  });

  it('does not report fulfillment success or create an audit entry when the order write fails', async () => {
    mocks.state.order = orderDocument();
    mocks.state.failOrderWrite = true;
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    const route = await import('../src/app/api/orders/route');

    const response = await route.PATCH(request('PATCH', { orderId: 'order-a', deliveredQuantity: 4 }));

    expect(response.status).toBe(500);
    expect(mocks.state.order).toMatchObject({ deliveredQuantity: 0, pendingQuantity: 10, status: 'pending' });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
