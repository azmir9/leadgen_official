import { describe, expect, it } from 'vitest';
import { deriveAdminStatus, getAdminInactivityWindowMs } from '@/lib/admin-status';

describe('server-derived Admin status', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const admin = (fields: Record<string, unknown> = {}) => ({ _id: 'admin-id', status: 'active', ...fields });

  it('uses an unexpired current-version session as active', () => {
    expect(deriveAdminStatus(admin({ lastActiveAt: new Date(now - 60 * 60_000) }), new Set(['admin-id']), now)).toBe('active');
  });

  it('uses recent authenticated activity only when it occurred after logout', () => {
    expect(deriveAdminStatus(admin({ lastActiveAt: new Date(now - 5 * 60_000) }), new Set(), now)).toBe('active');
    expect(deriveAdminStatus(admin({ lastActiveAt: new Date(now - 5 * 60_000), lastLoggedOutAt: new Date(now - 2 * 60_000) }), new Set(), now)).toBe('inactive');
  });

  it('marks stale, disabled, blocked, and deleted accounts distinctly', () => {
    expect(deriveAdminStatus(admin({ lastActiveAt: new Date(now - 20 * 60_000) }), new Set(), now)).toBe('inactive');
    expect(deriveAdminStatus(admin({ status: 'inactive' }), new Set(['admin-id']), now)).toBe('inactive');
    expect(deriveAdminStatus(admin({ status: 'blocked' }), new Set(['admin-id']), now)).toBe('blocked');
    expect(deriveAdminStatus(admin({ status: 'deleted', deletedAt: new Date() }), new Set(['admin-id']), now)).toBe('deleted');
  });

  it('uses the configured inactivity threshold within safe bounds and defaults to 15 minutes', () => {
    expect(getAdminInactivityWindowMs('30')).toBe(30 * 60_000);
    expect(getAdminInactivityWindowMs('0')).toBe(15 * 60_000);
    expect(getAdminInactivityWindowMs('1441')).toBe(15 * 60_000);
  });
});
