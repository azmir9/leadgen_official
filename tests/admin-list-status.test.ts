import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const now = Date.now();
  const candidates = [
    { _id: 'admin-online', status: 'active', sessionVersion: 3, lastActiveAt: new Date(now - 60 * 60_000), lastLoggedOutAt: null },
    { _id: 'admin-recent', status: 'active', sessionVersion: 1, lastActiveAt: new Date(now - 5 * 60_000), lastLoggedOutAt: new Date(now - 10 * 60_000) },
    { _id: 'admin-offline', status: 'active', sessionVersion: 1, lastActiveAt: new Date(now - 30 * 60_000), lastLoggedOutAt: null },
    { _id: 'admin-logged-out', status: 'active', sessionVersion: 1, lastActiveAt: new Date(now - 2 * 60_000), lastLoggedOutAt: new Date(now - 60_000) },
  ];
  const rows = [
    ...candidates,
    { _id: 'admin-disabled', status: 'inactive', sessionVersion: 0, lastActiveAt: null, lastLoggedOutAt: null },
    { _id: 'admin-blocked', status: 'blocked', sessionVersion: 5, lastActiveAt: new Date(now), lastLoggedOutAt: null },
  ];
  const makeQuery = (value: unknown) => {
    const builder = { select: vi.fn(() => builder), sort: vi.fn(() => builder), skip: vi.fn(() => builder), limit: vi.fn(() => builder), lean: vi.fn(async () => value) };
    return builder;
  };
  return {
    candidates, rows, now,
    getSessionFromRequest: vi.fn(async () => ({ id: 'owner-id', role: 'super-admin' })),
    connectDB: vi.fn(),
    userFind: vi.fn((filter: Record<string, unknown>) => makeQuery(filter.role === 'admin' && filter.status === 'active' && filter.deletedAt === null ? candidates : rows)),
    userCount: vi.fn(async () => rows.length),
    sessionFind: vi.fn(() => makeQuery([
      { userId: 'admin-online', sessionVersion: 3 },
      { userId: 'admin-online', sessionVersion: 2 },
    ])),
    workspaceFind: vi.fn(() => makeQuery([])),
    joinLinkFind: vi.fn(() => makeQuery([])),
  };
});

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  User: { find: mocks.userFind, countDocuments: mocks.userCount },
  AuthSession: { find: mocks.sessionFind },
  Workspace: { find: mocks.workspaceFind },
  JoinLink: { find: mocks.joinLinkFind },
  AuditLog: { create: vi.fn() },
}));

describe('Admin list server-derived status filters', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('ADMIN_INACTIVITY_MINUTES', '15'); });
  afterEach(() => vi.unstubAllEnvs());

  it('hides deleted accounts and derives current presence from sessions and recent activity', async () => {
    const { GET } = await import('../src/app/api/admins/route');
    const response = await GET(new Request('https://app.example.test/api/admins') as never);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.admins.map((admin: { id: string; status: string }) => [admin.id, admin.status])).toEqual([
      ['admin-online', 'active'], ['admin-recent', 'active'], ['admin-offline', 'inactive'],
      ['admin-logged-out', 'inactive'], ['admin-disabled', 'inactive'], ['admin-blocked', 'blocked'],
    ]);
    expect(mocks.userFind).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'admin', deletedAt: null, status: { $ne: 'deleted' } }));
    expect(mocks.sessionFind).toHaveBeenCalledWith(expect.objectContaining({ revokedAt: null, expiresAt: { $gt: expect.any(Date) } }));
  });

  it('filters Active and Inactive using calculated presence rather than a browser status flag', async () => {
    const { GET } = await import('../src/app/api/admins/route');
    await GET(new Request('https://app.example.test/api/admins?status=active') as never);
    const activeFilter = mocks.userFind.mock.calls.at(-1)?.[0] as { $and?: Record<string, unknown>[] };
    expect(activeFilter.$and?.[1]).toEqual({ _id: { $in: ['admin-online', 'admin-recent'] } });

    await GET(new Request('https://app.example.test/api/admins?status=inactive') as never);
    const inactiveFilter = mocks.userFind.mock.calls.at(-1)?.[0] as { $and?: Record<string, unknown>[] };
    expect(inactiveFilter.$and?.[1]).toMatchObject({ $or: expect.arrayContaining([{ status: 'inactive' }, { status: 'active', _id: { $nin: ['admin-online', 'admin-recent'] } }]) });
  });
});
