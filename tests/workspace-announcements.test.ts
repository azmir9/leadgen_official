import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const workspaces: Record<string, { _id: string; adminId: string; isActive: boolean; settings: Record<string, unknown> }> = {
    'workspace-a': { _id: 'workspace-a', adminId: 'admin-a', isActive: true, settings: { operationalSetting: 'preserve-a', announcements: [{ id: 'announcement-a', message: 'Workspace A notice', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] } },
    'workspace-b': { _id: 'workspace-b', adminId: 'admin-b', isActive: true, settings: { operationalSetting: 'preserve-b', announcements: [{ id: 'announcement-b', message: 'Workspace B notice', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] } },
  };
  return {
    workspaces,
    session: { id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' } as { id: string; role: string; workspaceId: string | null },
    connectDB: vi.fn(),
    getSessionFromRequest: vi.fn(),
    workspaceFindOne: vi.fn(),
    workspaceFindOneAndUpdate: vi.fn(),
    auditCreate: vi.fn(),
    companyFindOne: vi.fn(),
    companyFindOneAndUpdate: vi.fn(),
  };
});

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  Workspace: { findOne: mocks.workspaceFindOne, findOneAndUpdate: mocks.workspaceFindOneAndUpdate },
  AuditLog: { create: mocks.auditCreate },
  CompanySettings: { findOne: mocks.companyFindOne, findOneAndUpdate: mocks.companyFindOneAndUpdate },
}));

function query<T>(value: T) {
  const builder = {
    select: vi.fn(() => builder),
    lean: vi.fn().mockResolvedValue(value),
  };
  return builder;
}

function matches(workspace: typeof mocks.workspaces[string] | undefined, filter: Record<string, unknown>) {
  if (!workspace || workspace._id !== filter._id) return false;
  if (filter.adminId && workspace.adminId !== filter.adminId) return false;
  if (filter.isActive !== undefined && workspace.isActive !== filter.isActive) return false;
  const announcementId = filter['settings.announcements.id'];
  if (announcementId && !(workspace.settings.announcements as { id: string }[]).some((item) => item.id === announcementId)) return false;
  return true;
}

function request(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { origin: 'https://app.example.test', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as never;
}

describe('workspace scoped announcements', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.session.id = 'admin-a';
    mocks.session.role = 'admin';
    mocks.session.workspaceId = 'workspace-a';
    mocks.workspaces['workspace-a'].settings = { operationalSetting: 'preserve-a', announcements: [{ id: 'announcement-a', message: 'Workspace A notice', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] };
    mocks.workspaces['workspace-b'].settings = { operationalSetting: 'preserve-b', announcements: [{ id: 'announcement-b', message: 'Workspace B notice', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] };
    mocks.getSessionFromRequest.mockImplementation(async () => ({ ...mocks.session }));
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.workspaceFindOne.mockImplementation((filter: Record<string, unknown>) => {
      const workspace = mocks.workspaces[String(filter._id)];
      return query(matches(workspace, filter) ? structuredClone(workspace) : null);
    });
    mocks.workspaceFindOneAndUpdate.mockImplementation((filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const workspace = mocks.workspaces[String(filter._id)];
      if (!matches(workspace, filter)) return query(null);
      const pushed = (update.$push as Record<string, unknown> | undefined)?.['settings.announcements'];
      if (pushed) (workspace.settings.announcements as unknown[]).unshift(pushed);
      const set = update.$set as Record<string, unknown> | undefined;
      if (set?.['settings.announcements.$.message']) {
        const id = String(filter['settings.announcements.id']);
        const item = (workspace.settings.announcements as Record<string, unknown>[]).find((announcement) => announcement.id === id);
        if (item) {
          item.message = set['settings.announcements.$.message'];
          item.updatedAt = set['settings.announcements.$.updatedAt'];
        }
      }
      const pull = (update.$pull as Record<string, { id: string }> | undefined)?.['settings.announcements'];
      if (pull) workspace.settings.announcements = (workspace.settings.announcements as { id: string }[]).filter((item) => item.id !== pull.id);
      return query(structuredClone(workspace));
    });
    mocks.auditCreate.mockResolvedValue([]);
    mocks.companyFindOne.mockReturnValue(query({ announcement: 'Global company notice', companyName: 'Leadgen Official' }));
    mocks.companyFindOneAndUpdate.mockReturnValue(query({ _id: 'company-settings', announcement: 'Updated global notice' }));
  });

  it('preserves Super Admin control of global announcements and global read access', async () => {
    const companyRoute = await import('../src/app/api/company/route');
    const globalResponse = await companyRoute.GET();
    expect((await globalResponse.json()).announcement).toBe('Global company notice');

    mocks.session.role = 'admin';
    const denied = await companyRoute.PUT(request('https://app.example.test/api/company', 'PUT', { announcement: 'Not allowed' }));
    expect(denied.status).toBe(403);
    expect(mocks.companyFindOneAndUpdate).not.toHaveBeenCalled();

    mocks.session.role = 'super-admin';
    const saved = await companyRoute.PUT(request('https://app.example.test/api/company', 'PUT', { announcement: 'Updated global notice' }));
    expect(saved.status).toBe(200);
    expect(mocks.companyFindOneAndUpdate).toHaveBeenCalled();
    const workerPage = readFileSync(new URL('../src/app/worker/page.tsx', import.meta.url), 'utf8');
    expect(workerPage).toContain('announcement={company.announcement}');
  });

  it('limits Admin announcement reads and writes to the session-owned workspace', async () => {
    const route = await import('../src/app/api/announcements/route');
    const response = await route.GET(request('https://app.example.test/api/announcements?workspaceId=workspace-b', 'GET'));
    expect((await response.json()).announcements.map((item: { id: string }) => item.id)).toEqual(['announcement-a']);
    expect(mocks.workspaceFindOne).toHaveBeenCalledWith({ _id: 'workspace-a', adminId: 'admin-a', isActive: true });

    const rejectedSpoof = await route.POST(request('https://app.example.test/api/announcements', 'POST', { workspaceId: 'workspace-b', message: 'Spoofed' }));
    expect(rejectedSpoof.status).toBe(403);
    expect(mocks.workspaceFindOneAndUpdate).not.toHaveBeenCalled();

    const created = await route.POST(request('https://app.example.test/api/announcements', 'POST', { message: 'Workspace A only' }));
    expect(created.status).toBe(201);
    expect(mocks.workspaceFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'workspace-a', adminId: 'admin-a', isActive: true },
      expect.objectContaining({ $push: { 'settings.announcements': expect.objectContaining({ message: 'Workspace A only' }) } }),
      { returnDocument: 'after' },
    );
    expect(mocks.workspaces['workspace-b'].settings.announcements).toHaveLength(1);
  });

  it('shows a Worker only announcements from the workspace in the refreshed session', async () => {
    const route = await import('../src/app/api/announcements/route');
    mocks.session.id = 'worker-a';
    mocks.session.role = 'worker';
    const responseA = await route.GET(request('https://app.example.test/api/announcements?workspaceId=workspace-b', 'GET'));
    expect((await responseA.json()).announcements.map((item: { message: string }) => item.message)).toEqual(['Workspace A notice']);
    expect(mocks.workspaceFindOne).toHaveBeenCalledWith({ _id: 'workspace-a', isActive: true });

    mocks.session.workspaceId = 'workspace-b';
    const responseB = await route.GET(request('https://app.example.test/api/announcements', 'GET'));
    expect((await responseB.json()).announcements.map((item: { message: string }) => item.message)).toEqual(['Workspace B notice']);
  });

  it('rejects Worker edits and Admin edits of another workspace announcement', async () => {
    const route = await import('../src/app/api/announcements/route');
    mocks.session.id = 'worker-a';
    mocks.session.role = 'worker';
    const workerEdit = await route.PATCH(request('https://app.example.test/api/announcements', 'PATCH', { id: 'announcement-a', message: 'Tampered' }));
    expect(workerEdit.status).toBe(403);

    mocks.session.id = 'admin-b';
    mocks.session.role = 'admin';
    mocks.session.workspaceId = 'workspace-b';
    const adminEdit = await route.PATCH(request('https://app.example.test/api/announcements', 'PATCH', { id: 'announcement-a', message: 'Tampered' }));
    expect(adminEdit.status).toBe(404);
    expect(mocks.workspaceFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'workspace-b', adminId: 'admin-b', isActive: true, 'settings.announcements.id': 'announcement-a' },
      expect.any(Object),
      { returnDocument: 'after' },
    );
    const adminDelete = await route.DELETE(request('https://app.example.test/api/announcements?id=announcement-a', 'DELETE'));
    expect(adminDelete.status).toBe(404);
    expect(mocks.workspaceFindOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: 'workspace-b', adminId: 'admin-b', isActive: true, 'settings.announcements.id': 'announcement-a' },
      { $pull: { 'settings.announcements': { id: 'announcement-a' } } },
      { returnDocument: 'after' },
    );
    expect((mocks.workspaces['workspace-a'].settings.announcements as { message: string }[])[0].message).toBe('Workspace A notice');
    expect((mocks.workspaces['workspace-a'].settings.announcements as { id: string }[]).some((item) => item.id === 'announcement-a')).toBe(true);
  });

  it('does not let announcement writes alter unrelated optional workspace settings', async () => {
    const route = await import('../src/app/api/announcements/route');
    const response = await route.POST(request('https://app.example.test/api/announcements', 'POST', {
      message: 'Notice', settings: { operationalSetting: 'tampered', isActive: false }, adminId: 'attacker',
    }));
    expect(response.status).toBe(201);
    expect(mocks.workspaces['workspace-a'].settings.operationalSetting).toBe('preserve-a');
    expect(mocks.workspaces['workspace-a'].isActive).toBe(true);
    expect(mocks.workspaceFindOneAndUpdate.mock.calls.at(-1)?.[1]).toEqual({
      $push: { 'settings.announcements': expect.objectContaining({ message: 'Notice' }) },
    });
  });

  it('rejects a cross-origin mutation before database access or writes', async () => {
    const route = await import('../src/app/api/announcements/route');
    const response = await route.POST(new Request('https://app.example.test/api/announcements', {
      method: 'POST',
      headers: { origin: 'https://attacker.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'forbidden' }),
    }) as never);
    expect(response.status).toBe(403);
    expect(mocks.connectDB).not.toHaveBeenCalled();
    expect(mocks.workspaceFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
