import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({ RateLimitBucket: { findOneAndUpdate: mocks.findOneAndUpdate } }));

import { enforceRateLimit, missingClientIdentityResponse, requestIdentity } from '@/lib/rate-limit';
import { createAuthDiagnosticContext } from '@/lib/auth-diagnostics';

function bucketResult(result: unknown) {
  return { lean: vi.fn().mockResolvedValue(result) };
}

describe('enforceRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    mocks.connectDB.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses valid Vercel platform client IP headers and rejects missing or untrusted values', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    expect(requestIdentity(new Request('https://app.example.invalid', { headers: { 'x-vercel-forwarded-for': '203.0.113.4, 10.0.0.1', 'x-real-ip': '192.0.2.2' } }))).toBe('203.0.113.4');
    expect(requestIdentity(new Request('https://app.example.invalid', { headers: { 'x-real-ip': '192.0.2.2' } }))).toBe('192.0.2.2');
    expect(requestIdentity(new Request('https://app.example.invalid', { headers: { 'x-forwarded-for': '203.0.113.9' } }))).toBeNull();
    expect(requestIdentity(new Request('https://app.example.invalid', { headers: { 'x-vercel-forwarded-for': 'not-an-ip', 'x-real-ip': 'also-invalid' } }))).toBeNull();
    expect(requestIdentity(new Request('https://app.example.invalid'))).toBeNull();
  });

  it('does not trust Vercel-looking headers when production is not running on Vercel', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '');
    expect(requestIdentity(new Request('https://app.example.invalid', { headers: { 'x-vercel-forwarded-for': '203.0.113.4' } }))).toBeNull();
  });

  it('returns a traceable 503 rather than using a shared bucket when trusted IP is unavailable', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = missingClientIdentityResponse('register_rate_limit_ip', 'Unavailable.', 'safe-request-id');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: 'Unavailable.', requestId: 'safe-request-id' });
    expect(log).toHaveBeenCalledWith({ requestId: 'safe-request-id', stage: 'register_rate_limit_ip', reason: 'trusted_client_ip_unavailable' });
  });

  it('keeps registration buckets distinct for distinct client IPs', async () => {
    mocks.findOneAndUpdate.mockReturnValue(bucketResult({ count: 1 }));
    const firstIdentity = requestIdentity(new Request('https://app.example.invalid', { headers: { 'x-vercel-forwarded-for': '203.0.113.4' } }));
    const secondIdentity = requestIdentity(new Request('https://app.example.invalid', { headers: { 'x-vercel-forwarded-for': '203.0.113.5' } }));
    if (!firstIdentity || !secondIdentity) throw new Error('Expected valid test IP identities.');

    await enforceRateLimit('registration-ip', firstIdentity, 6, 60 * 60 * 1000);
    await enforceRateLimit('registration-ip', secondIdentity, 6, 60 * 60 * 1000);

    const keys = mocks.findOneAndUpdate.mock.calls.map(([filter]) => (filter as { key: string }).key);
    expect(keys[0]).not.toBe(keys[1]);
    expect(JSON.stringify(keys)).not.toContain(firstIdentity);
    expect(JSON.stringify(keys)).not.toContain(secondIdentity);
  });

  it('returns 429 after the configured request limit and preserves Retry-After', async () => {
    mocks.findOneAndUpdate.mockReturnValue(bucketResult({ count: 3 }));

    const response = await enforceRateLimit('login-ip', 'test-client', 2, 60_000);

    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(mocks.connectDB).toHaveBeenCalledOnce();
    expect(mocks.findOneAndUpdate).toHaveBeenCalledOnce();
  });

  it('logs a fixed registration rejection code and returns a correlatable request ID', async () => {
    const context = createAuthDiagnosticContext('register_rate_limit_ip_bucket');
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.findOneAndUpdate.mockReturnValue(bucketResult({ count: 7 }));

    const response = await enforceRateLimit('registration-ip', 'test-client-ip', 6, 60 * 60 * 1000, {
      context,
      connectStage: 'register_rate_limit_ip_connect',
      bucketStage: 'register_rate_limit_ip_bucket',
      retryStage: 'register_rate_limit_ip_retry',
      decisionStage: 'register_rate_limit_ip',
      decisionReason: 'registration_ip_limit_exceeded',
    });

    expect(response?.status).toBe(429);
    expect(await response?.json()).toMatchObject({ requestId: context.requestId });
    expect(log).toHaveBeenCalledWith({ requestId: context.requestId, stage: 'register_rate_limit_ip', reason: 'registration_ip_limit_exceeded', identityMissing: false, connectionAction: 'unknown' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-client-ip');
  });

  it('allows six registration attempts and blocks the seventh in the same hourly bucket', async () => {
    mocks.findOneAndUpdate.mockImplementation(() => bucketResult({ count: mocks.findOneAndUpdate.mock.calls.length }));
    const results = [];

    for (let attempt = 0; attempt < 7; attempt += 1) {
      results.push(await enforceRateLimit('registration-ip', 'test-client', 6, 60 * 60 * 1000));
    }

    expect(results.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(results[6]?.status).toBe(429);
    const operations = mocks.findOneAndUpdate.mock.calls.map(([filter]) => filter as Record<string, unknown>);
    expect(new Set(operations.map((filter) => filter.bucket)).size).toBe(1);
    expect(new Set(operations.map((filter) => filter.key)).size).toBe(1);
    expect(JSON.stringify(operations)).not.toContain('test-client');
  });

  it('logs slow MongoDB connection stages without logging connection details', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValueOnce(2_200);
    const context = createAuthDiagnosticContext('register_rate_limit_ip_connect');
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.findOneAndUpdate.mockReturnValue(bucketResult({ count: 1 }));

    await enforceRateLimit('registration-ip', 'test-client-ip', 6, 60 * 60 * 1000, {
      context,
      connectStage: 'register_rate_limit_ip_connect',
      bucketStage: 'register_rate_limit_ip_bucket',
      retryStage: 'register_rate_limit_ip_retry',
      decisionStage: 'register_rate_limit_ip',
      decisionReason: 'registration_ip_limit_exceeded',
    });

    expect(log).toHaveBeenCalledWith({ requestId: context.requestId, stage: 'register_rate_limit_ip_connect', reason: 'rate_limit_storage_slow', elapsedMs: 1_200 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-client-ip');
  });

  it('propagates database connection errors without attempting a bucket operation', async () => {
    const connectionError = new Error('connection failed');
    mocks.connectDB.mockRejectedValue(connectionError);

    await expect(enforceRateLimit('login-ip', 'test-client', 2, 60_000)).rejects.toBe(connectionError);
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('logs a sanitized connection diagnostic when callers omit a diagnostic context', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.connectDB.mockRejectedValue(Object.assign(
      new Error('connect failed: mongodb://private-user:private-password@db.example.invalid/app'),
      { code: 'ENOTFOUND' },
    ));

    await expect(enforceRateLimit('login-ip', 'test-client', 2, 60_000)).rejects.toThrow('connect failed');

    expect(log).toHaveBeenCalledOnce();
    const diagnostic = log.mock.calls[0][0] as Record<string, unknown>;
    expect(diagnostic).toMatchObject({ stage: 'rate_limit_database_connect', category: 'dns_srv_failure' });
    expect(JSON.stringify(diagnostic)).not.toContain('private-user');
    expect(JSON.stringify(diagnostic)).not.toContain('private-password');
    expect(JSON.stringify(diagnostic)).not.toContain('db.example.invalid');
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('retries a concurrent bucket insert after duplicate key code 11000', async () => {
    const duplicateKey = Object.assign(new Error('duplicate key'), { code: 11000 });
    mocks.findOneAndUpdate
      .mockReturnValueOnce({ lean: vi.fn().mockRejectedValue(duplicateKey) })
      .mockReturnValueOnce(bucketResult({ count: 1 }));

    const response = await enforceRateLimit('login-ip', 'test-client', 2, 60_000);

    expect(response).toBeNull();
    expect(mocks.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('propagates bucket write errors instead of bypassing rate limiting', async () => {
    const writeError = new Error('bucket write failed');
    mocks.findOneAndUpdate.mockReturnValue({ lean: vi.fn().mockRejectedValue(writeError) });

    await expect(enforceRateLimit('login-ip', 'test-client', 2, 60_000)).rejects.toBe(writeError);
  });
});
