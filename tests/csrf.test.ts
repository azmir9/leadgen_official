import { describe, expect, it } from 'vitest';
import { isSameOriginRequest } from '../src/lib/csrf';
import { readFileSync } from 'node:fs';

describe('same-origin request protection', () => {
  it('accepts a valid same-origin Origin header', () => {
    expect(isSameOriginRequest(new Request('https://app.example.test/api/change', {
      method: 'POST', headers: { origin: 'https://app.example.test' },
    }))).toBe(true);
  });

  it('rejects a cross-origin Origin header even when Referer is same-origin', () => {
    expect(isSameOriginRequest(new Request('https://app.example.test/api/change', {
      method: 'POST', headers: { origin: 'https://attacker.example.test', referer: 'https://app.example.test/page' },
    }))).toBe(false);
  });

  it('rejects missing Origin and Referer headers', () => {
    expect(isSameOriginRequest(new Request('https://app.example.test/api/change', { method: 'POST' }))).toBe(false);
  });

  it('rejects malformed Origin and does not fall back to Referer', () => {
    expect(isSameOriginRequest(new Request('https://app.example.test/api/change', {
      method: 'POST', headers: { origin: 'null', referer: 'https://app.example.test/page' },
    }))).toBe(false);
  });

  it('accepts a same-origin Referer only when Origin is absent', () => {
    expect(isSameOriginRequest(new Request('https://app.example.test/api/change', {
      method: 'POST', headers: { referer: 'https://app.example.test/page?return=ok' },
    }))).toBe(true);
  });

  it('rejects malformed and cross-origin Referer fallback values', () => {
    for (const referer of ['not-a-url', 'https://attacker.example.test/page']) {
      expect(isSameOriginRequest(new Request('https://app.example.test/api/change', {
        method: 'POST', headers: { referer },
      }))).toBe(false);
    }
  });

  it('guards every cookie-authenticated state-changing handler in the route inventory', () => {
    const handlers: [string, string][] = [
      ['src/app/api/reports/route.ts', 'POST'],
      ['src/app/api/workers/route.ts', 'PATCH'],
      ['src/app/api/orders/route.ts', 'POST'],
      ['src/app/api/orders/route.ts', 'PATCH'],
      ['src/app/api/assignments/route.ts', 'POST'],
      ['src/app/api/admins/route.ts', 'POST'],
      ['src/app/api/admins/[adminId]/route.ts', 'PATCH'],
      ['src/app/api/admins/[adminId]/joining-link/route.ts', 'POST'],
      ['src/app/api/admins/[adminId]/joining-link/route.ts', 'DELETE'],
      ['src/app/api/lead-approvals/route.ts', 'POST'],
      ['src/app/api/profile/route.ts', 'PATCH'],
      ['src/app/api/auth/change-password/route.ts', 'POST'],
      ['src/app/api/auth/logout/route.ts', 'POST'],
      ['src/app/api/daily-rates/route.ts', 'POST'],
      ['src/app/api/interviews/route.ts', 'POST'],
      ['src/app/api/interviews/route.ts', 'PATCH'],
      ['src/app/api/cms/route.ts', 'POST'],
      ['src/app/api/cms/route.ts', 'PUT'],
      ['src/app/api/cms/[contentId]/route.ts', 'DELETE'],
      ['src/app/api/payments/route.ts', 'POST'],
      ['src/app/api/payments/[paymentId]/route.ts', 'PATCH'],
      ['src/app/api/company/route.ts', 'PUT'],
      ['src/app/api/announcements/route.ts', 'POST'],
      ['src/app/api/announcements/route.ts', 'PATCH'],
      ['src/app/api/announcements/route.ts', 'DELETE'],
      ['src/app/api/workspace/settings/route.ts', 'PATCH'],
    ];

    for (const [file, method] of handlers) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      const start = source.indexOf(`export async function ${method}(`);
      expect(start, `${file} ${method} handler exists`).toBeGreaterThanOrEqual(0);
      const nextHandler = source.indexOf('\nexport async function ', start + 1);
      const handlerSource = source.slice(start, nextHandler < 0 ? undefined : nextHandler);
      expect(handlerSource, `${file} ${method} enforces same-origin before its logic`).toContain('isSameOriginRequest(request)');
    }
  });
});
