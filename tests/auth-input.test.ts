import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ connectDB: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(), missingClientIdentityResponse: vi.fn(), requestIdentity: vi.fn(() => 'test-client') }));
vi.mock('@/lib/auth', () => ({ createServerSession: vi.fn() }));
vi.mock('@/lib/invitations', () => ({ hashInvitationToken: vi.fn() }));
vi.mock('@/lib/models', () => ({ AuditLog: {}, JoinLink: {}, User: {}, Workspace: {} }));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as register } from '@/app/api/auth/register/route';
import { connectDB } from '@/lib/db';
import { enforceRateLimit } from '@/lib/rate-limit';

afterEach(() => {
  vi.clearAllMocks();
});

describe('auth request body validation', () => {
  it.each([
    ['login', login],
    ['registration', register],
  ])('returns 400 for malformed %s JSON without database access', async (_name, handler) => {
    const request = new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const response = await handler(request);

    expect(response.status).toBe(400);
    expect(connectDB).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ['login', login],
    ['registration', register],
  ])('returns 400 for non-object %s JSON without database access', async (_name, handler) => {
    const request = new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await handler(request);

    expect(response.status).toBe(400);
    expect(connectDB).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });
});
