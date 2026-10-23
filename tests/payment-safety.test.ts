import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), connectDB: vi.fn(), preview: vi.fn(), paymentFind: vi.fn(), paymentCount: vi.fn(),
  paymentFindOne: vi.fn(), paymentCreate: vi.fn(), paymentUpdate: vi.fn(), paymentStartSession: vi.fn(),
  allocationInsert: vi.fn(), allocationUpdate: vi.fn(), auditCreate: vi.fn(), rateFind: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.session }));
vi.mock('@/lib/csrf', () => ({ isSameOriginRequest: () => true }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/payments', () => ({ buildClearancePreview: mocks.preview }));
vi.mock('@/lib/models', () => ({
  Payment: { find: mocks.paymentFind, countDocuments: mocks.paymentCount, findOne: mocks.paymentFindOne, create: mocks.paymentCreate, updateOne: mocks.paymentUpdate, startSession: mocks.paymentStartSession },
  PaymentAllocation: { insertMany: mocks.allocationInsert, updateMany: mocks.allocationUpdate },
  AuditLog: { create: mocks.auditCreate },
  User: { find: vi.fn() },
  DailyRate: { find: mocks.rateFind },
}));

function makeTransactionSession() {
  return { withTransaction: vi.fn(async (callback: () => Promise<unknown>) => callback()), endSession: vi.fn() };
}

describe('payment security and clearance', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.session.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: null });
    mocks.paymentStartSession.mockResolvedValue(makeTransactionSession());
    mocks.preview.mockResolvedValue({
      worker: { id: 'worker-a', status: 'active', paymentAccounts: { 'Bank Transfer': 'test-bank-details' } },
      lines: [{ reportDate: '2026-10-10', approvedLeads: 2, currency: 'BDT', ratePerLead: 10, adjustmentAmount: 0, adjustmentReason: '', amount: 20 }],
      missing: [], alreadyPaid: [], grossAmount: 20, adjustmentTotal: 0, payableAmount: 20, currency: 'BDT',
    });
    mocks.paymentCreate.mockResolvedValue([{ _id: 'payment-a' }]);
  });

  it('does not let a workspace-less Admin list global payment or daily-rate records', async () => {
    const paymentRoute = await import('../src/app/api/payments/route');
    const rateRoute = await import('../src/app/api/daily-rates/route');
    const paymentResponse = await paymentRoute.GET(new Request('https://app.example.test/api/payments') as never);
    const rateResponse = await rateRoute.GET(new Request('https://app.example.test/api/daily-rates') as never);
    expect(paymentResponse.status).toBe(403);
    expect(rateResponse.status).toBe(403);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });

  it.each(['Bank Transfer', 'Cash'])('records %s as a supported payment channel', async (paymentMethod) => {
    mocks.session.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    const route = await import('../src/app/api/payments/route');
    const response = await route.POST(new Request('https://app.example.test/api/payments', {
      method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ workerId: 'worker-a', reportDates: ['2026-10-10'], paymentMethod, workspaceId: 'workspace-a' }),
    }) as never);
    expect(response.status).toBe(201);
    const created = mocks.paymentCreate.mock.calls[0][0][0];
    expect(created.paymentMethod).toBe(paymentMethod);
    expect(created.accountSnapshot).toBe(paymentMethod === 'Cash' ? 'Cash' : 'test-bank-details');
  });

  it('does not void allocations or audit when a concurrent payment status update already won', async () => {
    mocks.session.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    mocks.paymentFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'payment-a', workspaceId: 'workspace-a', status: 'cleared', transactionReference: '' }) });
    mocks.paymentUpdate.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const route = await import('../src/app/api/payments/[paymentId]/route');
    const response = await route.PATCH(new Request('https://app.example.test/api/payments/payment-a', {
      method: 'PATCH', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'void', workspaceId: 'workspace-a' }),
    }) as never, { params: Promise.resolve({ paymentId: 'payment-a' }) });
    expect(response.status).toBe(409);
    expect(mocks.allocationUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('records a partial payment, remaining balance, and audit entry atomically', async () => {
    mocks.session.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    mocks.paymentFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'payment-a', workspaceId: 'workspace-a', status: 'cleared', payableAmount: 20, paidAmount: 0, transactionReference: '' }) });
    mocks.paymentUpdate.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mocks.auditCreate.mockResolvedValue(undefined);
    const route = await import('../src/app/api/payments/[paymentId]/route');
    const response = await route.PATCH(new Request('https://app.example.test/api/payments/payment-a', {
      method: 'PATCH', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'paid', paidAmount: 7.5, transactionReference: 'safe-test-ref', workspaceId: 'workspace-a' }),
    }) as never, { params: Promise.resolve({ paymentId: 'payment-a' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'partially_paid', paidAmount: 7.5, remainingBalance: 12.5 });
    expect(mocks.paymentUpdate.mock.calls[0][1].$set).toMatchObject({ status: 'partially_paid', paidAmount: 7.5, transactionReference: 'safe-test-ref' });
    expect(mocks.paymentUpdate.mock.calls[0][1].$push.paymentHistory).toMatchObject({ amount: 7.5, transactionReference: 'safe-test-ref', recordedBy: 'admin-a' });
    expect(mocks.auditCreate.mock.calls[0][0][0]).toMatchObject({ action: 'payment.partially_paid', details: { previousPaidAmount: 0, paidNow: 7.5, paidAmount: 7.5, remainingBalance: 12.5 } });
  });

  it('rejects an amount above the remaining balance before opening a transaction', async () => {
    mocks.session.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    mocks.paymentFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'payment-a', workspaceId: 'workspace-a', status: 'partially_paid', payableAmount: 20, paidAmount: 15, transactionReference: '' }) });
    const route = await import('../src/app/api/payments/[paymentId]/route');
    const response = await route.PATCH(new Request('https://app.example.test/api/payments/payment-a', {
      method: 'PATCH', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'paid', paidAmount: 6, workspaceId: 'workspace-a' }),
    }) as never, { params: Promise.resolve({ paymentId: 'payment-a' }) });
    expect(response.status).toBe(409);
    expect(mocks.paymentStartSession).not.toHaveBeenCalled();
  });
});
