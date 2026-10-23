import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revokeServerSession: vi.fn(),
  getSessionFromRequest: vi.fn(),
  connectDB: vi.fn(),
  enforceRateLimit: vi.fn(),
  hashInvitationToken: vi.fn(),
  auditFind: vi.fn(),
  auditCount: vi.fn(),
  joinLinkFind: vi.fn(),
  userExists: vi.fn(),
  userFind: vi.fn(),
  userCreate: vi.fn(),
  workspaceExists: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ revokeServerSession: mocks.revokeServerSession, getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.enforceRateLimit, missingClientIdentityResponse: vi.fn(), requestIdentity: () => 'test-client' }));
vi.mock('@/lib/invitations', () => ({ hashInvitationToken: mocks.hashInvitationToken }));
vi.mock('@/lib/models', () => ({
  AuditLog: { find: mocks.auditFind, countDocuments: mocks.auditCount, create: vi.fn() },
  JoinLink: { findOne: mocks.joinLinkFind, updateOne: vi.fn() },
  User: { exists: mocks.userExists, findOne: mocks.userFind, create: mocks.userCreate, updateOne: vi.fn() },
  Workspace: { exists: mocks.workspaceExists, findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));

describe('security route fixes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.revokeServerSession.mockResolvedValue(undefined);
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'admin-id', role: 'admin', workspaceId: null });
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.enforceRateLimit.mockResolvedValue(null);
    mocks.hashInvitationToken.mockReturnValue('hashed-invitation');
  });

  it('uses POST for logout, checks request origin, revokes the token, and clears its cookie', async () => {
    const route = await import('../src/app/api/auth/logout/route');
    const rejected = await route.POST(new Request('https://app.example.test/api/auth/logout', {
      method: 'POST', headers: { origin: 'https://attacker.example.test', cookie: 'leadgen_session=opaque-token' },
    }));
    expect(rejected.status).toBe(403);
    expect(mocks.revokeServerSession).not.toHaveBeenCalled();

    const accepted = await route.POST(new Request('https://app.example.test/api/auth/logout', {
      method: 'POST', headers: { origin: 'https://app.example.test', cookie: 'leadgen_session=opaque-token' },
    }));
    expect(accepted.status).toBe(200);
    expect(mocks.revokeServerSession).toHaveBeenCalledWith('opaque-token');
    expect(accepted.headers.get('set-cookie')).toContain('leadgen_session=');
    expect('GET' in route).toBe(false);
  });

  it('rejects an Admin without a workspace before querying audit logs', async () => {
    const route = await import('../src/app/api/audit/route');
    const response = await route.GET(new Request('https://app.example.test/api/audit') as never);
    expect(response.status).toBe(403);
    expect(mocks.connectDB).not.toHaveBeenCalled();
    expect(mocks.auditFind).not.toHaveBeenCalled();
    expect(mocks.auditCount).not.toHaveBeenCalled();
  });

  it('does not reveal whether a username or email already exists', async () => {
    mocks.joinLinkFind.mockReturnValue({ lean: vi.fn().mockResolvedValue({
      _id: 'join-id', adminId: 'admin-id', workspaceId: 'workspace-id', tokenHash: 'hashed-invitation',
    }) });
    mocks.userExists.mockResolvedValue(true);
    mocks.workspaceExists.mockResolvedValue(true);
    mocks.userFind.mockResolvedValue({ _id: 'existing-user' });
    const route = await import('../src/app/api/auth/register/route');
    const response = await route.POST(new Request('https://app.example.test/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Worker', username: 'newworker', email: 'new@example.test', password: 'a-long-test-password', confirmPassword: 'a-long-test-password', invitationToken: 'A'.repeat(43) }),
    }));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.message).not.toMatch(/username|email|already registered|exists/i);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });
});
