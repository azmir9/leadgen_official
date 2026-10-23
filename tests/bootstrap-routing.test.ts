import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionFromCookies: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock('@/lib/auth', () => ({ getSessionFromCookies: mocks.getSessionFromCookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

describe('login and role redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('keeps the login page on the existing login form', async () => {
    const { default: LoginPage } = await import('../src/app/login/page');
    const element = LoginPage() as ReactElement<{ children: ReactElement<{ mode: string }> }>;

    expect(element.props.children.props.mode).toBe('login');
  });

  it.each([
    ['super-admin', '/super-admin'],
    ['admin', '/admin'],
    ['worker', '/worker'],
  ])('redirects %s sessions to the expected dashboard', async (role, destination) => {
    mocks.getSessionFromCookies.mockResolvedValue({ role });
    const { default: DashboardPage } = await import('../src/app/dashboard/page');

    await expect(DashboardPage()).rejects.toThrow(`redirect:${destination}`);
    expect(mocks.redirect).toHaveBeenCalledWith(destination);
  });

  it.each(['admin', 'worker'])('keeps the Super Admin page restricted from %s sessions', async (role) => {
    mocks.getSessionFromCookies.mockResolvedValue({ role });
    const { default: SuperAdminPage } = await import('../src/app/super-admin/page');

    await expect(SuperAdminPage()).rejects.toThrow('redirect:/login');
  });
});
