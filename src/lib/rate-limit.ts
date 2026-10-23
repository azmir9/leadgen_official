import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { RateLimitBucket } from '@/lib/models';
import { createAuthDiagnosticContext, runAuthDiagnosticStage, type AuthDiagnosticContext, type AuthDiagnosticStage } from '@/lib/auth-diagnostics';

const SLOW_RATE_LIMIT_STAGE_MS = 1_000;

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function requestIdentity(request: Request): string | null {
  // In production, only accept headers injected by Vercel's trusted edge. For any other
  // production host, fail closed until its trusted-proxy contract is explicitly configured.
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL !== '1') return null;

  for (const header of ['x-vercel-forwarded-for', 'x-real-ip']) {
    const candidate = request.headers.get(header)?.split(',')[0]?.trim();
    if (!candidate || isIP(candidate) === 0) continue;
    if (isIP(candidate) === 4) return candidate;
    try {
      return new URL(`http://[${candidate}]/`).hostname.slice(1, -1);
    } catch {
      // Continue to the other platform header when an IPv6 value is malformed.
    }
  }
  return null;
}

export function missingClientIdentityResponse(
  stage: 'register_rate_limit_ip' | 'login_rate_limit_ip' | 'password_reset_request_ip' | 'password_reset_completion_ip',
  message: string,
  requestId: string = randomUUID(),
) {
  console.warn({ requestId, stage, reason: 'trusted_client_ip_unavailable' });
  return NextResponse.json({ message, requestId }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

interface RateLimitDiagnostics {
  context: AuthDiagnosticContext;
  connectStage: AuthDiagnosticStage;
  bucketStage: AuthDiagnosticStage;
  retryStage: AuthDiagnosticStage;
  decisionStage?: AuthDiagnosticStage;
  decisionReason?: string;
}

async function runObservedStage<T>(
  context: AuthDiagnosticContext,
  stage: AuthDiagnosticStage,
  operation: () => Promise<T>,
  shouldLogFailure?: (error: unknown) => boolean,
) {
  const startedAt = Date.now();
  try {
    return await runAuthDiagnosticStage(context, stage, operation, shouldLogFailure);
  } finally {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= SLOW_RATE_LIMIT_STAGE_MS) {
      console.warn({ requestId: context.requestId, stage, reason: 'rate_limit_storage_slow', elapsedMs });
    }
  }
}

export async function enforceRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
  diagnostics?: RateLimitDiagnostics,
) {
  const diagnosticContext = diagnostics?.context ?? createAuthDiagnosticContext('rate_limit_database_connect');
  const connectStage = diagnostics?.connectStage ?? 'rate_limit_database_connect';
  await runObservedStage(diagnosticContext, connectStage, () => connectDB(diagnosticContext));
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const hashedKey = digest(`${scope}:${key}`);
  let entry;
  try {
    const updateBucket = () => RateLimitBucket.findOneAndUpdate(
        { key: hashedKey, bucket },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ).lean();
    entry = await runObservedStage(
      diagnosticContext,
      diagnostics?.bucketStage ?? 'rate_limit_bucket',
      updateBucket,
      (error) => !(error && typeof error === 'object' && 'code' in error && error.code === 11000),
    );
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
    const retryBucket = () => RateLimitBucket.findOneAndUpdate(
      { key: hashedKey, bucket },
      { $inc: { count: 1 } },
      { returnDocument: 'after' },
    ).lean();
    entry = await runObservedStage(diagnosticContext, diagnostics?.retryStage ?? 'rate_limit_bucket_retry', retryBucket);
  }

  if ((entry?.count || 0) <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000));
  console.warn({
    requestId: diagnosticContext.requestId,
    stage: diagnostics?.decisionStage ?? diagnostics?.bucketStage ?? 'rate_limit_bucket',
    reason: diagnostics?.decisionReason ?? 'rate_limit_exceeded',
    identityMissing: key === 'unknown',
    connectionAction: diagnosticContext.connectionAction ?? 'unknown',
  });
  return NextResponse.json(
    { message: 'Too many attempts. Try again later.', requestId: diagnosticContext.requestId },
    { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } },
  );
}
