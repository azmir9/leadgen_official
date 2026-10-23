import { createHash, randomBytes } from 'node:crypto';

export const WORKER_ONBOARDING_COOKIE = 'leadgen_worker_onboarding';
export const WORKER_ONBOARDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createWorkerOnboardingToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashWorkerOnboardingToken(token), expiresAt: new Date(Date.now() + WORKER_ONBOARDING_TTL_MS) };
}

export function hashWorkerOnboardingToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
