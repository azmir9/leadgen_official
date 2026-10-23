import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { role: 'super-admin', status: 'active' as 'active' | 'inactive' | 'blocked' | 'deleted', audits: [] as Record<string, unknown>[] };
  const databaseSession = { withTransaction: vi.fn(async (callback: () => Promise<void>) => callback()), endSession: vi.fn() };
  const query = <T>(value: T) => {
    const builder = {
      select: vi.fn(() => builder), session: vi.fn(() => builder),
      lean: vi.fn(async () => value),
    };
    return builder;
  };
  const userFindOne = vi.fn(() => query({ _id: '507f1f77bcf86cd799439011', name: 'Target Admin', status: state.status, workspaceId: 'workspace-a' }));
  const userFindOneAndUpdate = vi.fn((_filter: Record<string, unknown>, update: Record<string, unknown>) => {
    state.status = (update.$set as { status: 'inactive' | 'blocked' | 'active' | 'deleted' }).status;
    return query({ _id: '507f1f77bcf86cd799439011', workspaceId: 'workspace-a' });
  });
  const joinLinkUpdateMany = vi.fn(async () => ({ modifiedCount: 2 }));
  const authSessionUpdateMany = vi.fn(async () => ({ modifiedCount: 3 }));
  const auditCreate = vi.fn(async (entries: Record<string, unknown>[]) => { state.audits.push(...entries); });
  return {
    state, databaseSession, userFindOne, userFindOneAndUpdate, joinLinkUpdateMany, authSessionUpdateMany, auditCreate,
    connectDB: vi.fn(),
    getSessionFromRequest: vi.fn(async () => ({ id: 'owner-id', role: state.role })),
  };
});

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/csrf', () => ({ isSameOriginRequest: vi.fn(() => true) }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  User: { startSession: vi.fn(async () => mocks.databaseSession), findOne: mocks.userFindOne, findOneAndUpdate: mocks.userFindOneAndUpdate },
  JoinLink: { updateMany: mocks.joinLinkUpdateMany },
  AuthSession: { updateMany: mocks.authSessionUpdateMany },
  AuditLog: { create: mocks.auditCreate },
}));

async function deleteAdmin(adminId = '507f1f77bcf86cd799439011') {
  const { DELETE } = await import('../src/app/api/admins/[adminId]/route');
  const request = new Request(`https://app.example.test/api/admins/${adminId}`, { method: 'DELETE' });
  return DELETE(request as never, { params: Promise.resolve({ adminId }) });
}

async function updateAdminStatus(status: string) {
  const { PATCH } = await import('../src/app/api/admins/[adminId]/route');
  const request = new Request('https://app.example.test/api/admins/507f1f77bcf86cd799439011', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
  return PATCH(request as never, { params: Promise.resolve({ adminId: '507f1f77bcf86cd799439011' }) });
}

describe('Super Admin Admin lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.state.role = 'super-admin';
    mocks.state.status = 'active';
    mocks.state.audits = [];
    mocks.getSessionFromRequest.mockImplementation(async () => ({ id: 'owner-id', role: mocks.state.role }));
    mocks.userFindOne.mockImplementation(() => {
      const admin = { _id: '507f1f77bcf86cd799439011', name: 'Target Admin', status: mocks.state.status, workspaceId: 'workspace-a' };
      const builder = { select: vi.fn(() => builder), session: vi.fn(() => builder), lean: vi.fn(async () => admin) };
      return builder as never;
    });
    mocks.userFindOneAndUpdate.mockImplementation((_filter, update) => {
      mocks.state.status = (update.$set as { status: 'inactive' | 'blocked' | 'active' | 'deleted' }).status;
      const builder = { select: vi.fn(() => builder), lean: vi.fn(async () => ({ _id: '507f1f77bcf86cd799439011', workspaceId: 'workspace-a' })) };
      return builder as never;
    });
    mocks.databaseSession.withTransaction.mockImplementation(async (callback) => callback());
    mocks.joinLinkUpdateMany.mockResolvedValue({ modifiedCount: 2 });
    mocks.authSessionUpdateMany.mockResolvedValue({ modifiedCount: 3 });
  });

  it('allows only a Super Admin to soft-delete an Admin', async () => {
    for (const role of ['admin', 'worker']) {
      mocks.state.role = role;
      const response = await deleteAdmin();
      expect(response.status).toBe(403);
      expect(mocks.connectDB).not.toHaveBeenCalled();
    }
  });

  it('rejects direct block and unblock calls from ordinary Admins and Workers', async () => {
    for (const role of ['admin', 'worker']) {
      mocks.state.role = role;
      const response = await updateAdminStatus('blocked');
      expect(response.status).toBe(403);
      expect(mocks.connectDB).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed IDs before database access', async () => {
    const response = await deleteAdmin('not-an-object-id');
    expect(response.status).toBe(400);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });

  it('moves the account into history atomically, revokes sessions and links, and retains business records', async () => {
    const response = await deleteAdmin();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'deleted', revokedLinks: 2, revokedSessions: 3, historyPreserved: true });
    expect(mocks.userFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd799439011', role: 'admin', status: 'active', deletedAt: null },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'deleted', deletedBy: 'owner-id', deletedAt: expect.any(Date) }), $inc: { sessionVersion: 1 } }),
      expect.objectContaining({ session: mocks.databaseSession }),
    );
    expect(mocks.joinLinkUpdateMany).toHaveBeenCalledWith({ adminId: '507f1f77bcf86cd799439011', status: 'active' }, { $set: { status: 'revoked' } }, { session: mocks.databaseSession });
    expect(mocks.authSessionUpdateMany).toHaveBeenCalledWith({ userId: '507f1f77bcf86cd799439011', revokedAt: null }, expect.any(Object), { session: mocks.databaseSession });
    expect(mocks.state.audits[0]).toMatchObject({ action: 'admin.soft_deleted', resourceId: '507f1f77bcf86cd799439011', details: expect.objectContaining({ historyPreserved: true }) });
    expect(mocks.userFindOne).toHaveBeenCalledWith({ _id: '507f1f77bcf86cd799439011', role: 'admin' });
    expect(mocks.databaseSession.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.databaseSession.endSession).toHaveBeenCalledOnce();
  });

  it('returns a conflict for a repeated request and does not write a second audit event', async () => {
    mocks.state.status = 'deleted';
    const response = await deleteAdmin();
    expect(response.status).toBe(409);
    expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('blocks an Admin transactionally and revokes their existing sessions', async () => {
    const response = await updateAdminStatus('blocked');
    expect(response.status).toBe(200);
    expect(mocks.state.status).toBe('blocked');
    expect(mocks.authSessionUpdateMany).toHaveBeenCalledWith({ userId: '507f1f77bcf86cd799439011', revokedAt: null }, expect.any(Object), { session: mocks.databaseSession });
    expect(mocks.state.audits[0]).toMatchObject({ action: 'admin.blocked' });
  });

  it('unblocks without creating or restoring a session', async () => {
    mocks.state.status = 'blocked';
    const response = await updateAdminStatus('active');
    expect(response.status).toBe(200);
    expect(mocks.state.status).toBe('active');
    expect(mocks.authSessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.state.audits[0]).toMatchObject({ action: 'admin.unblocked' });
  });
});
