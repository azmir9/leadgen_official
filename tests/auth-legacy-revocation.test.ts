import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  sessionFindOne: vi.fn(),
  sessionUpdateOne: vi.fn(),
  sessionCreate: vi.fn(),
  userFindById: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  AuthSession: { findOne: mocks.sessionFindOne, updateOne: mocks.sessionUpdateOne, create: mocks.sessionCreate },
  User: { findById: mocks.userFindById },
}));

describe('legacy JWT logout revocation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-only-jwt-key');
    mocks.sessionUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    mocks.sessionCreate.mockResolvedValue({});
  });

  afterEach(() => vi.unstubAllEnvs());

  it('stores a revocation record for a valid legacy token and rejects it on resolution', async () => {
    const { signUserToken, revokeServerSession, getSessionFromRequest } = await import('../src/lib/auth');
    const token = signUserToken({
      id: 'legacy-user-id', name: 'Legacy User', email: 'legacy@example.test', username: 'legacyuser',
      role: 'worker', workspaceId: 'workspace-id', status: 'active', sessionVersion: 4,
    });

    await revokeServerSession(token);
    const revokedRecord = mocks.sessionCreate.mock.calls[0][0];
    expect(revokedRecord).toMatchObject({
      userId: 'legacy-user-id', sessionVersion: 4, revokedAt: expect.any(Date), expiresAt: expect.any(Date),
    });

    mocks.sessionFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(revokedRecord) });
    const request = {
      cookies: { get: vi.fn().mockReturnValue({ value: token }) },
    } as never;
    await expect(getSessionFromRequest(request)).resolves.toBeNull();
    expect(mocks.userFindById).not.toHaveBeenCalled();
  });
});
