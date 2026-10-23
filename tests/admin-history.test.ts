import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { role: 'super-admin' };
  const query = (value: unknown) => {
    const builder = {
      select: vi.fn(() => builder), sort: vi.fn(() => builder), skip: vi.fn(() => builder), limit: vi.fn(() => builder),
      lean: vi.fn(async () => value),
    };
    return builder;
  };
  return {
    state,
    getSessionFromRequest: vi.fn(async () => ({ id: 'owner-id', role: state.role })),
    connectDB: vi.fn(),
    adminQuery: vi.fn(() => query([{ _id: '507f1f77bcf86cd799439011', name: 'Deleted Admin', username: 'old-admin', workspaceId: 'workspace-id', deletedAt: new Date('2026-10-20T00:00:00Z'), deletedBy: 'owner-id', deletionPreviousStatus: 'blocked' }])),
    actorQuery: vi.fn(() => query([{ _id: 'owner-id', name: 'Owner', username: 'owner', role: 'super-admin' }])),
    workspaceQuery: vi.fn(() => query([{ _id: 'workspace-id', adminId: '507f1f77bcf86cd799439011', name: 'Retained Workspace' }])),
    deletedAccountQuery: vi.fn(() => query({ _id: '507f1f77bcf86cd799439011' })),
    countDocuments: vi.fn(async () => 1),
  };
});

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/csrf', () => ({ isSameOriginRequest: vi.fn(() => true) }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  User: { find: vi.fn((filter: Record<string, unknown>) => filter.role === 'admin' ? mocks.adminQuery() : mocks.actorQuery()), findOne: vi.fn(() => mocks.deletedAccountQuery()), countDocuments: mocks.countDocuments },
  Workspace: { find: mocks.workspaceQuery },
}));

describe('Super Admin Admin History', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); mocks.state.role = 'super-admin';
    mocks.getSessionFromRequest.mockImplementation(async () => ({ id: 'owner-id', role: mocks.state.role }));
  });

  it('restricts history reads to Super Admins', async () => {
    const { GET } = await import('../src/app/api/admin-history/route');
    for (const role of ['admin', 'worker']) {
      mocks.state.role = role;
      const response = await GET(new Request('https://app.example.test/api/admin-history') as never);
      expect(response.status).toBe(403);
      expect(mocks.connectDB).not.toHaveBeenCalled();
    }
  });

  it('returns deleted account history and retained workspace/actor references only to Super Admins', async () => {
    const { GET } = await import('../src/app/api/admin-history/route');
    const response = await GET(new Request('https://app.example.test/api/admin-history') as never);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.entries[0]).toMatchObject({ name: 'Deleted Admin', username: 'old-admin', previousStatus: 'blocked', workspace: { id: 'workspace-id', name: 'Retained Workspace' }, deletedBy: { id: 'owner-id', name: 'Owner' } });
    expect(mocks.adminQuery).toHaveBeenCalledOnce();
  });

  it('requires the irreversible-action phrase, then safely blocks permanent deletion without writes', async () => {
    const { POST } = await import('../src/app/api/admin-history/[adminId]/permanent-delete/route');
    const id = '507f1f77bcf86cd799439011';
    const response = await POST(new Request(`https://app.example.test/api/admin-history/${id}/permanent-delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'PERMANENTLY DELETE' }) }) as never, { params: Promise.resolve({ adminId: id }) });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.permanentDeletionAvailable).toBe(false);
    expect(body.message).toContain('retained audit, report, assignment, order, rate, payment, and invitation records');
    expect(mocks.deletedAccountQuery).toHaveBeenCalledOnce();
  });
});
