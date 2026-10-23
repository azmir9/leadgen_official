import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    session: { id: 'sa-1', role: 'super-admin', name: 'Owner', username: 'owner', email: 'owner@example.test' } as null | { id: string; role: string; name: string; username: string; email: string },
    admin: { _id: 'admin-1', name: 'Admin', username: 'admin', email: 'admin@example.test', status: 'active', workspaceId: 'workspace-1' },
    workspace: { _id: 'workspace-1', adminId: 'admin-1', name: 'Workspace One', isActive: true, settings: { announcements: [{ id: 'ann-1', message: 'Workspace note' }] } },
    assignmentUsernames: ['zero-user', 'missing-user'],
    calls: [] as { model: string; method: string; filter?: Record<string, unknown> }[],
  };
  const connectDB = vi.fn();
  const getSessionFromRequest = vi.fn();
  const mutators = { create: vi.fn(), insertMany: vi.fn(), updateOne: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() };
  const findOne = (model: string) => vi.fn((filter: Record<string, unknown>) => {
    state.calls.push({ model, method: 'findOne', filter });
    return query(model === 'User' ? state.admin : model === 'Workspace' ? state.workspace : { announcement: 'Global note' });
  });
  const find = (model: string) => vi.fn((filter: Record<string, unknown>) => {
    state.calls.push({ model, method: 'find', filter });
    if (model === 'User' && filter.role === 'worker' && filter._id) return query([{ _id: 'worker-1', name: 'Worker One', username: 'workerone' }]);
    if (model === 'User' && filter.role === 'worker') return query([{ _id: 'worker-1', name: 'Worker One', username: 'workerone', email: 'worker@example.test', status: 'active' }]);
    if (model === 'Assignment' && filter.status === 'active' && filter.username) return query([{ username: 'zero-user', workerId: 'worker-1' }, { username: 'missing-user', workerId: 'worker-1' }]);
    if (model === 'OfficialReport') return query([{ normalizedUsername: 'zero-user', reportValue: 0, reportDate: '2026-10-18', uploadedBy: 'admin-1' }]);
    return query([]);
  });
  const countDocuments = (model: string) => vi.fn((filter: Record<string, unknown>) => {
    state.calls.push({ model, method: 'countDocuments', filter });
    return Promise.resolve(1);
  });
  const query = (value: unknown) => {
    const builder = {
      select: vi.fn(() => builder), sort: vi.fn(() => builder), skip: vi.fn(() => builder), limit: vi.fn(() => builder),
      lean: vi.fn(async () => value),
    };
    return builder;
  };
  return {
    state, connectDB, getSessionFromRequest, mutators,
    User: { findOne: findOne('User'), find: find('User'), countDocuments: countDocuments('User'), ...mutators },
    Workspace: { findOne: findOne('Workspace'), ...mutators },
    Assignment: { find: find('Assignment'), countDocuments: countDocuments('Assignment'), distinct: vi.fn(async (_field: string, filter: Record<string, unknown>) => { state.calls.push({ model: 'Assignment', method: 'distinct', filter }); return state.assignmentUsernames; }), ...mutators },
    UserOrder: { find: find('UserOrder'), countDocuments: countDocuments('UserOrder'), ...mutators },
    OfficialReport: { find: find('OfficialReport'), countDocuments: countDocuments('OfficialReport'), ...mutators },
    DailyRate: { find: find('DailyRate'), countDocuments: countDocuments('DailyRate'), ...mutators },
    LeadApproval: { find: find('LeadApproval'), countDocuments: countDocuments('LeadApproval'), ...mutators },
    PaymentAllocation: { find: find('PaymentAllocation'), countDocuments: countDocuments('PaymentAllocation'), ...mutators },
    Payment: { find: find('Payment'), countDocuments: countDocuments('Payment'), ...mutators },
    Interview: { find: find('Interview'), countDocuments: countDocuments('Interview'), ...mutators },
    CompanySettings: { findOne: findOne('CompanySettings'), ...mutators },
  };
});

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  User: mocks.User, Workspace: mocks.Workspace, Assignment: mocks.Assignment, UserOrder: mocks.UserOrder,
  OfficialReport: mocks.OfficialReport, DailyRate: mocks.DailyRate, LeadApproval: mocks.LeadApproval,
  PaymentAllocation: mocks.PaymentAllocation, Payment: mocks.Payment,
  Interview: mocks.Interview, CompanySettings: mocks.CompanySettings,
}));

async function getDetails(url = 'https://app.example.test/api/super-admin/admins/admin-1/details?date=2026-10-18') {
  const route = await import('../src/app/api/super-admin/admins/[adminId]/details/route');
  return route.GET(new Request(url) as never, { params: Promise.resolve({ adminId: 'admin-1' }) });
}

describe('Super Admin Admin Details read API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.state.session = { id: 'sa-1', role: 'super-admin', name: 'Owner', username: 'owner', email: 'owner@example.test' };
    mocks.state.admin = { _id: 'admin-1', name: 'Admin', username: 'admin', email: 'admin@example.test', status: 'active', workspaceId: 'workspace-1' };
    mocks.state.workspace = { _id: 'workspace-1', adminId: 'admin-1', name: 'Workspace One', isActive: true, settings: { announcements: [{ id: 'ann-1', message: 'Workspace note' }] } };
    mocks.state.assignmentUsernames = ['zero-user', 'missing-user'];
    mocks.state.calls = [];
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.getSessionFromRequest.mockImplementation(async () => mocks.state.session);
  });

  it('rejects non-Super Admin roles before database access', async () => {
    mocks.state.session = { id: 'admin-1', role: 'admin', name: 'Admin', username: 'admin', email: 'admin@example.test' };
    const response = await getDetails();
    expect(response.status).toBe(403);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });

  it('resolves the Admin-owned Workspace and scopes every data query to it', async () => {
    const response = await getDetails();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.workspace.id).toBe('workspace-1');
    expect(body.workers.items.map((worker: { name: string }) => worker.name)).toEqual(['Worker One']);
    expect(body.announcements).toEqual({ global: 'Global note', workspace: [{ id: 'ann-1', message: 'Workspace note', createdAt: '', updatedAt: '' }] });
    expect(mocks.Workspace.findOne).toHaveBeenCalledWith({ adminId: 'admin-1' });
    for (const call of mocks.state.calls.filter((item) => !['User', 'Workspace', 'CompanySettings'].includes(item.model))) {
      expect(call.filter?.workspaceId).toBe('workspace-1');
    }
    expect(mocks.User.find).toHaveBeenCalledWith(expect.objectContaining({ role: 'worker', workspaceId: 'workspace-1' }));
    expect(mocks.state.calls.some((call) => call.model === 'User' && call.filter?.role === 'worker' && call.filter?.workspaceId !== 'workspace-1')).toBe(false);
  });

  it('fails closed when Admin workspaceId and Workspace owner relationship disagree', async () => {
    mocks.state.workspace = { ...mocks.state.workspace, _id: 'another-workspace' };
    const response = await getDetails();
    expect(response.status).toBe(409);
    expect(mocks.UserOrder.find).not.toHaveBeenCalled();
    expect(mocks.Assignment.find).not.toHaveBeenCalled();
  });

  it('filters reports by selected date and keeps zero distinct from a missing assigned report', async () => {
    const response = await getDetails();
    const body = await response.json();
    expect(body.date).toBe('2026-10-18');
    expect(body.reports.items).toEqual([
      { username: 'missing-user', workerName: 'Worker One', reportValue: null, date: '2026-10-18' },
      { username: 'zero-user', workerName: 'Worker One', reportValue: 0, date: '2026-10-18' },
    ]);
    expect(mocks.OfficialReport.find).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-1', reportDate: '2026-10-18' }));
    expect(mocks.Assignment.distinct).toHaveBeenCalledWith('username', { workspaceId: 'workspace-1', status: 'active' });
  });

  it('does not call any state-changing model methods while viewing details', async () => {
    await getDetails();
    for (const mutator of Object.values(mocks.mutators)) expect(mutator).not.toHaveBeenCalled();
  });

  it('rejects malformed dates before database reads', async () => {
    const response = await getDetails('https://app.example.test/api/super-admin/admins/admin-1/details?date=tomorrow');
    expect(response.status).toBe(400);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });
});
