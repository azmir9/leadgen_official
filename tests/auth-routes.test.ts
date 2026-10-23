import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  enforceRateLimit: vi.fn(),
  missingClientIdentityResponse: vi.fn((_stage: string, message: string, requestId: string) => new Response(JSON.stringify({ message, requestId }), { status: 503 })),
  requestIdentity: vi.fn((): string | null => 'test-client'),
  createServerSession: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
  userFindOne: vi.fn(),
  interviewFindOne: vi.fn(),
  userUpdateOne: vi.fn(),
  userExists: vi.fn(),
  userCreate: vi.fn(),
  userStartSession: vi.fn(),
  transactionSession: { withTransaction: vi.fn(), endSession: vi.fn() },
  joinLinkFindOne: vi.fn(),
  joinLinkUpdateOne: vi.fn(),
  workspaceExists: vi.fn(),
  workspaceFindById: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare, hash: mocks.hash } }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.enforceRateLimit, missingClientIdentityResponse: mocks.missingClientIdentityResponse, requestIdentity: mocks.requestIdentity }));
vi.mock('@/lib/auth', () => ({ createServerSession: mocks.createServerSession }));
vi.mock('@/lib/invitations', () => ({ hashInvitationToken: vi.fn(() => 'hashed-invitation') }));
vi.mock('@/lib/models', () => ({
  AuditLog: { create: mocks.auditCreate },
  JoinLink: { findOne: mocks.joinLinkFindOne, updateOne: mocks.joinLinkUpdateOne },
  User: { findOne: mocks.userFindOne, updateOne: mocks.userUpdateOne, exists: mocks.userExists, create: mocks.userCreate, startSession: mocks.userStartSession },
  Interview: { findOne: mocks.interviewFindOne },
  Workspace: { exists: mocks.workspaceExists, findById: mocks.workspaceFindById },
}));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as register } from '@/app/api/auth/register/route';

const loginUser = {
  _id: 'safe-test-user-id', name: 'Test Admin', email: 'admin@example.invalid', username: 'test-admin',
  role: 'admin', workspaceId: 'safe-test-workspace-id', status: 'active', sessionVersion: 0,
  passwordHash: 'test-hash-not-a-real-credential',
};

function post(body: Record<string, unknown>) {
  return new Request('https://app.example.invalid/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function query(value: unknown) {
  const result = { select: vi.fn(() => result), lean: vi.fn().mockResolvedValue(value) };
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectDB.mockResolvedValue(undefined);
  mocks.enforceRateLimit.mockResolvedValue(null);
  mocks.compare.mockResolvedValue(true);
  mocks.hash.mockResolvedValue('test-hash-not-a-real-credential');
  mocks.createServerSession.mockResolvedValue({ token: 'test-session-token', maxAge: 86_400 });
  mocks.joinLinkUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mocks.transactionSession.withTransaction.mockImplementation((callback: () => Promise<unknown>) => callback());
  mocks.transactionSession.endSession.mockResolvedValue(undefined);
  mocks.userStartSession.mockResolvedValue(mocks.transactionSession);
  mocks.userUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mocks.joinLinkUpdateOne.mockResolvedValue({ matchedCount: 1 });
    mocks.workspaceFindById.mockReturnValue(query({ adminId: 'safe-owner-id', isActive: true }));
  mocks.auditCreate.mockResolvedValue(undefined);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('login and registration route behavior', () => {
  it('authenticates an active user and issues the existing HTTP-only session cookie', async () => {
    mocks.userFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(loginUser) });

    const response = await login(post({ username: 'test-admin', email: 'admin@example.invalid', password: 'synthetic-password' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('leadgen_worker_onboarding=;');
    expect(await response.json()).toMatchObject({ success: true, user: { role: 'admin', workspaceId: 'safe-test-workspace-id' } });
    expect(mocks.compare).toHaveBeenCalledWith('synthetic-password', loginUser.passwordHash);
    expect(mocks.createServerSession).toHaveBeenCalledOnce();
  });

  it('authenticates a stored Super Admin role through the shared login flow', async () => {
    const superAdmin = { ...loginUser, role: 'super-admin', workspaceId: null };
    mocks.userFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(superAdmin) });

    const response = await login(post({ username: 'test-admin', email: 'admin@example.invalid', password: 'synthetic-password' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, user: { role: 'super-admin', workspaceId: null } });
    expect(mocks.createServerSession).toHaveBeenCalledWith(expect.objectContaining({ role: 'super-admin' }), false, expect.any(Object));
  });

  it('uses the login identifier as its account rate-limit key', async () => {
    mocks.userFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    await login(post({ login: 'test-admin', password: 'synthetic-password' }));

    expect(mocks.enforceRateLimit).toHaveBeenNthCalledWith(2, 'login-account', 'test-admin', 8, 15 * 60 * 1000, expect.any(Object));
  });

  it('returns 401 for invalid credentials without creating a session', async () => {
    mocks.userFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    const response = await login(post({ username: 'missing-user', email: 'missing@example.invalid', password: 'synthetic-password' }));

    expect(response.status).toBe(401);
    expect(mocks.compare).not.toHaveBeenCalled();
    expect(mocks.createServerSession).not.toHaveBeenCalled();
  });

  it('returns 401 when password verification fails and does not create a session', async () => {
    mocks.userFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(loginUser) });
    mocks.compare.mockResolvedValue(false);

    const response = await login(post({ login: 'test-admin', password: 'incorrect-synthetic-password' }));

    expect(response.status).toBe(401);
    expect(mocks.userFindOne).toHaveBeenCalledWith({ $or: [{ username: 'test-admin' }, { email: 'test-admin' }] });
    expect(mocks.createServerSession).not.toHaveBeenCalled();
  });

  it('validates login input before rate limiting or database access', async () => {
    const response = await login(post({ username: 'test-admin', password: 'synthetic-password' }));

    expect(response.status).toBe(400);
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.connectDB).not.toHaveBeenCalled();
    expect(mocks.userFindOne).not.toHaveBeenCalled();
  });

  it('rejects inactive users without creating a session', async () => {
    mocks.userFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ ...loginUser, status: 'pending' }) });

    const response = await login(post({ login: 'test-admin', password: 'synthetic-password' }));

    expect(response.status).toBe(403);
    expect(mocks.createServerSession).not.toHaveBeenCalled();
  });

  it('lets a pending Worker with no interview continue only through the onboarding section', async () => {
    mocks.userFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ ...loginUser, role: 'worker', status: 'pending' }) });
    mocks.interviewFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    mocks.userUpdateOne.mockResolvedValue({ matchedCount: 1 });

    const response = await login(post({ login: 'worker-a', password: 'synthetic-password' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pendingApproval: true, redirectTo: '/interview' });
    expect(response.headers.get('set-cookie')).toContain('leadgen_worker_onboarding=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('leadgen_session=;');
    expect(mocks.createServerSession).not.toHaveBeenCalled();
  });

  it('rejects duplicate registration before hashing or creating an account', async () => {
    mocks.joinLinkFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'safe-test-link-id', adminId: 'safe-admin-id', workspaceId: 'safe-test-workspace-id' }) });
    mocks.userExists.mockResolvedValue(true);
    mocks.workspaceExists.mockResolvedValue(true);
    mocks.userFindOne.mockResolvedValue({ _id: 'existing-user-id' });

    const response = await register(post({ name: 'Test Worker', username: 'existing-user', email: 'existing@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password', invitationToken: 'safe-test-invitation-token-12345678901234567890' }));

    expect(response.status).toBe(400);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('validates registration fields before rate limiting or database access', async () => {
    const response = await register(post({ name: 'Test Worker', username: 'bad name', email: 'bad', password: 'short', confirmPassword: 'different' }));

    expect(response.status).toBe(400);
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.connectDB).not.toHaveBeenCalled();
    expect(mocks.joinLinkFindOne).not.toHaveBeenCalled();
  });

  it('uses only the registration IP limit and returns its 429 response without proceeding', async () => {
    const limitedResponse = new Response(JSON.stringify({ message: 'Too many attempts. Try again later.', requestId: 'safe-request-id' }), { status: 429 });
    mocks.enforceRateLimit.mockResolvedValue(limitedResponse);

    const response = await register(post({ name: 'Test Worker', username: 'new-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password' }));

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ requestId: 'safe-request-id' });
    expect(mocks.enforceRateLimit).toHaveBeenCalledOnce();
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith('registration-ip', 'test-client', 6, 60 * 60 * 1000, expect.objectContaining({
      decisionStage: 'register_rate_limit_ip',
      decisionReason: 'registration_ip_limit_exceeded',
    }));
    expect(mocks.connectDB).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when no trusted client IP is available', async () => {
    mocks.requestIdentity.mockReturnValueOnce(null);

    const response = await register(post({ name: 'Test Worker', username: 'new-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ requestId: expect.any(String) });
    expect(mocks.missingClientIdentityResponse).toHaveBeenCalledOnce();
    expect(mocks.missingClientIdentityResponse).toHaveBeenCalledWith('register_rate_limit_ip', expect.any(String), expect.any(String));
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('requires a registration Full Name before database access', async () => {
    const response = await register(post({ username: 'new-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password' }));
    expect(response.status).toBe(400);
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });

  it('rejects invalid invitations without checking account existence or hashing', async () => {
    mocks.joinLinkFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    const response = await register(post({ name: 'Test Worker', username: 'new-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password', invitationToken: 'safe-test-invitation-token-12345678901234567890' }));

    expect(response.status).toBe(400);
    expect(mocks.userExists).not.toHaveBeenCalled();
    expect(mocks.workspaceExists).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
  });

  it('rejects invitations whose admin or workspace is no longer active', async () => {
    mocks.joinLinkFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'safe-test-link-id', adminId: 'safe-admin-id', workspaceId: 'safe-test-workspace-id' }) });
    mocks.userExists.mockResolvedValue(false);
    mocks.workspaceExists.mockResolvedValue(true);

    const response = await register(post({ name: 'Test Worker', username: 'new-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password', invitationToken: 'safe-test-invitation-token-12345678901234567890' }));

    expect(response.status).toBe(400);
    expect(mocks.userExists).toHaveBeenCalledWith({ _id: 'safe-admin-id', role: 'admin', status: 'active', workspaceId: 'safe-test-workspace-id' });
    expect(mocks.workspaceExists).toHaveBeenCalledWith({ _id: 'safe-test-workspace-id', adminId: 'safe-admin-id', isActive: true });
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('registers a new pending worker into the workspace named by a valid invitation', async () => {
    mocks.joinLinkFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'safe-test-link-id', adminId: 'safe-admin-id', workspaceId: 'safe-test-workspace-id' }) });
    mocks.userExists.mockResolvedValue(true);
    mocks.workspaceExists.mockResolvedValue(true);
    mocks.userFindOne.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue([{ _id: 'safe-new-worker-id' }]);

    const response = await register(post({ name: 'Test Worker', username: 'new-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password', invitationToken: 'safe-test-invitation-token-12345678901234567890' }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, pendingApproval: true, redirectTo: '/interview', message: expect.stringContaining('Registration Successful!') });
    expect(response.headers.get('set-cookie')).toContain('leadgen_worker_onboarding=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(mocks.hash).toHaveBeenCalledWith('synthetic-password', 12);
    expect(mocks.userCreate).toHaveBeenCalledWith([expect.objectContaining({ role: 'worker', status: 'pending', approvalRequired: true, workspaceId: 'safe-test-workspace-id' })], { session: mocks.transactionSession });
    expect(mocks.joinLinkFindOne).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: 'hashed-invitation', status: 'active' }));
    expect(mocks.joinLinkUpdateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'safe-test-link-id', status: 'active' }), expect.any(Object), { session: mocks.transactionSession });
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    expect(mocks.auditCreate).toHaveBeenCalledWith([expect.objectContaining({ actorId: 'safe-new-worker-id', workspaceId: 'safe-test-workspace-id' })], { session: mocks.transactionSession });
    expect(mocks.transactionSession.endSession).toHaveBeenCalledOnce();
  });

  it('registers public Workers only in the active Super Admin owner workspace', async () => {
    vi.stubEnv('SUPER_ADMIN_USERNAME', '  TestOwner  ');
    mocks.userFindOne.mockImplementation((filter: Record<string, unknown>) => {
      if (filter.username === 'testowner') {
        return query({ _id: 'safe-owner-id', role: 'super-admin', status: 'active', workspaceId: 'safe-owner-workspace-id' });
      }
      return Promise.resolve(null);
    });
    mocks.userCreate.mockResolvedValue([{ _id: 'safe-public-worker-id' }]);

    const response = await register(post({ name: 'Test Worker', username: 'public-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password', workspaceId: 'browser-chosen-workspace' }));

    expect(response.status).toBe(201);
    expect(mocks.userFindOne).toHaveBeenCalledWith({ username: 'testowner' });
    expect(mocks.workspaceFindById).toHaveBeenCalledWith('safe-owner-workspace-id');
    expect(mocks.workspaceFindById.mock.results[0].value.select).toHaveBeenCalledWith('adminId isActive');
    expect(mocks.userCreate).toHaveBeenCalledWith([expect.objectContaining({ role: 'worker', status: 'pending', approvalRequired: true, workspaceId: 'safe-owner-workspace-id', onboardingTokenHash: expect.any(String), onboardingTokenExpiresAt: expect.any(Date) })], { session: mocks.transactionSession });
    expect(mocks.joinLinkFindOne).not.toHaveBeenCalled();
    expect((await response.json()).redirectTo).toBe('/interview');
  });

  it('fails closed for public joining when the configured owner identity is missing', async () => {
    vi.stubEnv('SUPER_ADMIN_USERNAME', '');

    const response = await register(post({ name: 'Test Worker', username: 'public-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ message: 'Public registration is temporarily unavailable. Please try again later or contact support.' });
    expect(body).toHaveProperty('requestId');
    expect(mocks.userFindOne).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('logs only a fixed reason code when the configured owner workspace is inactive or missing', async () => {
    vi.stubEnv('SUPER_ADMIN_USERNAME', 'testowner');
    mocks.userFindOne.mockReturnValue(query({ _id: 'private-owner-id', role: 'super-admin', status: 'active', workspaceId: 'private-workspace-id' }));
    mocks.workspaceFindById.mockReturnValue(query({ adminId: 'private-owner-id', isActive: false }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await register(post({ name: 'Test Worker', username: 'public-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'Public registration is temporarily unavailable. Please try again later or contact support.' });
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ stage: 'register_default_workspace_lookup', reason: 'configured_owner_workspace_inactive', requestId: expect.any(String) }));
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private-owner-id');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private-workspace-id');
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['configured username does not match a user', null, null, 'configured_owner_not_found'],
    ['configured username belongs to a non-owner role', { _id: 'owner-id', role: 'admin', status: 'active', workspaceId: 'workspace-id' }, null, 'configured_owner_role_mismatch'],
    ['configured owner account is inactive', { _id: 'owner-id', role: 'super-admin', status: 'inactive', workspaceId: 'workspace-id' }, null, 'configured_owner_inactive'],
    ['configured owner has no workspace reference', { _id: 'owner-id', role: 'super-admin', status: 'active', workspaceId: null }, null, 'configured_owner_workspace_reference_missing'],
    ['configured owner workspace record is missing', { _id: 'owner-id', role: 'super-admin', status: 'active', workspaceId: 'workspace-id' }, null, 'configured_owner_workspace_not_found'],
    ['configured owner workspace belongs to another account', { _id: 'owner-id', role: 'super-admin', status: 'active', workspaceId: 'workspace-id' }, { adminId: 'different-owner', isActive: true }, 'configured_owner_workspace_link_mismatch'],
  ])('diagnoses when %s', async (_description, owner, workspace, reason) => {
    vi.stubEnv('SUPER_ADMIN_USERNAME', 'testowner');
    mocks.userFindOne.mockReturnValue(query(owner));
    mocks.workspaceFindById.mockReturnValue(query(workspace));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await register(post({ name: 'Test Worker', username: 'public-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password' }));

    expect(response.status).toBe(400);
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ stage: 'register_default_workspace_lookup', reason, requestId: expect.any(String) }));
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('returns a validation response for a duplicate-key race during registration', async () => {
    mocks.joinLinkFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'safe-test-link-id', adminId: 'safe-admin-id', workspaceId: 'safe-test-workspace-id', tokenHash: 'hashed-invitation' }) });
    mocks.userExists.mockResolvedValue(true);
    mocks.workspaceExists.mockResolvedValue(true);
    mocks.userFindOne.mockResolvedValue(null);
    mocks.userCreate.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: 11000 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await register(post({ name: 'Test Worker', username: 'new-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password', invitationToken: 'safe-test-invitation-token-12345678901234567890' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'An account with that username or email already exists.' });
    expect(mocks.transactionSession.endSession).toHaveBeenCalledOnce();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('returns generic errors without leaking DB or password details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.enforceRateLimit.mockResolvedValue(null);
    mocks.connectDB.mockRejectedValueOnce(new Error('mongodb://private-host/private-db'));

    const response = await login(post({ login: 'test-admin', password: 'private-synthetic-password' }));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toBe(JSON.stringify({ message: 'Unable to sign in right now.' }));
    expect(body).not.toContain('private-host');
    expect(body).not.toContain('private-synthetic-password');
    expect(log).toHaveBeenCalledOnce();
  });

  it('keeps a rate-limit connection failure generic for both endpoints', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const [handler, body] of [
      [login, { username: 'test-admin', email: 'admin@example.invalid', password: 'synthetic-password' }],
      [register, { name: 'Test Worker', username: 'new-worker', email: 'worker@example.invalid', password: 'synthetic-password', confirmPassword: 'synthetic-password' }],
    ] as const) {
      mocks.enforceRateLimit.mockRejectedValueOnce(Object.assign(new Error('index mismatch'), { code: 86, codeName: 'IndexKeySpecsConflict' }));
      const response = await handler(post(body));
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain('IndexKeySpecsConflict');
    }
    expect(log).toHaveBeenCalledTimes(2);
  });
});
