import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyDiagnosticError, createAuthDiagnosticContext, logAuthDiagnosticFailure, runAuthDiagnosticStage } from '@/lib/auth-diagnostics';

describe('classifyDiagnosticError', () => {
  it('classifies server selection timeouts without using the error message', () => {
    const error = Object.assign(new Error('secret host and credentials'), { name: 'MongooseServerSelectionError' });
    expect(classifyDiagnosticError(error)).toBe('server_selection_timeout');
  });

  it('classifies nested DNS/SRV errors', () => {
    const error = Object.assign(new Error('private URI'), {
      name: 'MongoServerSelectionError',
      reason: { servers: new Map([['ignored', { error: { code: 'ENOTFOUND' } }]]) },
    });
    expect(classifyDiagnosticError(error)).toBe('dns_srv_failure');
  });

  it('classifies network and authentication failures using allow-listed fields', () => {
    expect(classifyDiagnosticError({ name: 'MongoNetworkError', code: 'ECONNRESET' })).toBe('tls_network_failure');
    expect(classifyDiagnosticError({ name: 'MongoServerError', code: 18 })).toBe('authentication_failure');
  });

  it('uses unknown for unrecognized errors', () => {
    expect(classifyDiagnosticError(new Error('do not log this message'))).toBe('unknown');
  });

  it('classifies MongoDB code 86 as an index specification conflict', () => {
    expect(classifyDiagnosticError(Object.assign(new Error('conflicting index details'), { code: 86 }))).toBe('index_key_specs_conflict');
  });
});

describe('diagnostic failure logging', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('logs stable sanitized fields without emitting stacks in any environment', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const error = Object.assign(new Error('Index conflict for username "worker99"; user bob.worker; pwd=private; user@example.invalid; dup key: { username: "worker99" }; mongodb+srv://dbuser:dbpass@cluster.example/db'), {
      code: 86,
      codeName: 'IndexKeySpecsConflict',
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const context = createAuthDiagnosticContext('login_rate_limit_ip_connect');

    logAuthDiagnosticFailure(context, error);

    const serialized = JSON.stringify(errorLog.mock.calls[0]);
    expect(serialized).toContain('index_key_specs_conflict');
    expect(serialized).toContain('IndexKeySpecsConflict');
    expect(serialized).not.toContain('worker99');
    expect(serialized).not.toContain('bob.worker');
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('user@example.invalid');
    expect(serialized).not.toContain('dbuser');
    expect(serialized).not.toContain('dbpass');
    expect(serialized).not.toContain('"stack"');
    expect(serialized).toContain(context.requestId);
    expect(serialized).toContain(context.runtimeId);
    expect(serialized).toContain('"errorName":"Error"');
    expect(serialized).toContain('"code":86');
    expect(serialized).toContain('"connectionAction":null');
    expect(serialized).toContain('"connectionReadyStateBefore":null');
    expect(serialized).toContain('"connectionReadyStateAfter":null');
    expect(serialized).not.toContain('"stack"');
  });

  it('includes explicit nulls when optional MongoDB diagnostics are unavailable', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logAuthDiagnosticFailure(createAuthDiagnosticContext('login_rate_limit_ip_connect'), new Error('failed'));

    const record = errorLog.mock.calls[0][0] as Record<string, unknown>;
    expect(record).toMatchObject({
      category: 'unknown',
      code: null,
      codeName: null,
      connectionAction: null,
      connectionReadyStateBefore: null,
      connectionReadyStateAfter: null,
      errorMessage: 'failed',
    });
    expect(record).toHaveProperty('runtimeId');
    expect(record).toHaveProperty('errorName');
  });

  it('does not let a failing logger replace the original operation error', async () => {
    const original = Object.assign(new Error('database operation failed'), { code: 86 });
    vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('logger failed'); });
    const context = createAuthDiagnosticContext('login_rate_limit_ip_connect');

    await expect(runAuthDiagnosticStage(context, 'login_rate_limit_ip_connect', async () => { throw original; })).rejects.toBe(original);
  });
});

vi.mock('@/lib/db', () => ({ connectDB: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(), missingClientIdentityResponse: vi.fn(), requestIdentity: vi.fn(() => 'test-client') }));
vi.mock('@/lib/auth', () => ({ createServerSession: vi.fn() }));
vi.mock('@/lib/invitations', () => ({ hashInvitationToken: vi.fn() }));
vi.mock('@/lib/models', () => ({ AuditLog: {}, JoinLink: {}, User: {}, Workspace: {} }));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as register } from '@/app/api/auth/register/route';
import { enforceRateLimit } from '@/lib/rate-limit';

afterEach(() => {
  vi.mocked(enforceRateLimit).mockReset();
  vi.restoreAllMocks();
});

describe('auth diagnostic error responses', () => {
  it.each([
    ['login', login, { username: 'test-user', email: 'test@example.invalid', password: 'private-password' }],
    ['registration', register, {
      name: 'Test User', username: 'test-user', email: 'test@example.invalid',
      password: 'private-password', confirmPassword: 'private-password',
    }],
  ])('keeps %s failures generic and logs no raw error or request fields', async (_name, handler, body) => {
    vi.mocked(enforceRateLimit).mockRejectedValue(new Error('private URI and credential details'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handler(new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: _name === 'login' ? 'Unable to sign in right now.' : 'Unable to create your account right now.',
    });
    expect(errorLog).toHaveBeenCalledTimes(1);
    const serializedLog = JSON.stringify(errorLog.mock.calls[0]);
    for (const sensitiveValue of ['private URI', 'credential details', 'private-password', 'test-user', 'test@example.invalid']) {
      expect(serializedLog).not.toContain(sensitiveValue);
    }
  });
});
