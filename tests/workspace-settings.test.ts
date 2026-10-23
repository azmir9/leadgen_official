import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: { id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' } as { id: string; role: string; workspaceId: string | null },
  workspaces: {
    a: { _id: 'workspace-a', name: 'Team A', adminId: 'admin-a', isActive: true },
    b: { _id: 'workspace-b', name: 'Team B', adminId: 'admin-b', isActive: true },
  },
  connectDB: vi.fn(),
  getSessionFromRequest: vi.fn(),
  workspaceFindOne: vi.fn(),
  workspaceFindOneAndUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  Workspace: { findOne: mocks.workspaceFindOne, findOneAndUpdate: mocks.workspaceFindOneAndUpdate },
  AuditLog: { create: mocks.auditCreate },
}));

function query<T>(value: T) {
  const builder = {
    select: vi.fn(() => builder),
    lean: vi.fn().mockResolvedValue(value),
  };
  return builder;
}

function request(method: string, body?: unknown) {
  return new Request('https://app.example.test/api/workspace/settings', {
    method,
    headers: { origin: 'https://app.example.test', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as never;
}

describe('Admin workspace name settings', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.assign(mocks.session, { id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    Object.assign(mocks.workspaces.a, { _id: 'workspace-a', name: 'Team A', adminId: 'admin-a', isActive: true });
    Object.assign(mocks.workspaces.b, { _id: 'workspace-b', name: 'Team B', adminId: 'admin-b', isActive: true });
    mocks.getSessionFromRequest.mockImplementation(async () => ({ ...mocks.session }));
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.workspaceFindOne.mockImplementation((filter: Record<string, unknown>) => {
      const workspace = Object.values(mocks.workspaces).find((item) => item._id === filter._id && item.adminId === filter.adminId);
      return query(workspace ? { _id: workspace._id, name: workspace.name } : null);
    });
    mocks.workspaceFindOneAndUpdate.mockImplementation((filter: Record<string, unknown>, update: { $set: { name: string } }) => {
      const workspace = Object.values(mocks.workspaces).find((item) => item._id === filter._id && item.adminId === filter.adminId);
      if (!workspace) return query(null);
      workspace.name = update.$set.name;
      return query({ _id: workspace._id, name: workspace.name });
    });
    mocks.auditCreate.mockResolvedValue([]);
  });

  it('returns and updates only the Admin-owned workspace name', async () => {
    const route = await import('../src/app/api/workspace/settings/route');
    const current = await route.GET(request('GET'));
    expect(await current.json()).toEqual({ name: 'Team A' });
    expect(mocks.workspaceFindOne).toHaveBeenCalledWith({ _id: 'workspace-a', adminId: 'admin-a' });

    const updated = await route.PATCH(request('PATCH', { name: 'My Operations Team' }));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ success: true, name: 'My Operations Team' });
    expect(mocks.workspaceFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'workspace-a', adminId: 'admin-a' },
      { $set: { name: 'My Operations Team' } },
      { returnDocument: 'after', runValidators: true },
    );
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-a', actorId: 'admin-a', action: 'workspace.name_updated',
      details: { before: 'Team A', after: 'My Operations Team' },
    }));
  });

  it('denies non-Admin access before database reads or writes', async () => {
    const route = await import('../src/app/api/workspace/settings/route');
    mocks.session.role = 'worker';
    const read = await route.GET(request('GET'));
    const update = await route.PATCH(request('PATCH', { name: 'Worker change' }));
    expect(read.status).toBe(403);
    expect(update.status).toBe(403);
    expect(mocks.connectDB).not.toHaveBeenCalled();
    expect(mocks.workspaceFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not accept a client-supplied workspace or update another workspace', async () => {
    const route = await import('../src/app/api/workspace/settings/route');
    const foreignWorkspace = await route.PATCH(request('PATCH', { name: 'Spoofed', workspaceId: 'workspace-b' }));
    expect(foreignWorkspace.status).toBe(400);
    expect(mocks.workspaceFindOneAndUpdate).not.toHaveBeenCalled();

    mocks.session.id = 'admin-b';
    mocks.session.workspaceId = 'workspace-b';
    const updated = await route.PATCH(request('PATCH', { name: 'Team B Operations' }));
    expect(updated.status).toBe(200);
    expect(mocks.workspaceFindOne).toHaveBeenCalledWith({ _id: 'workspace-b', adminId: 'admin-b' });
    expect(mocks.workspaceFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'workspace-b', adminId: 'admin-b' },
      { $set: { name: 'Team B Operations' } },
      { returnDocument: 'after', runValidators: true },
    );
    expect(mocks.workspaces.a.name).toBe('Team A');
    expect(mocks.workspaces.b.name).toBe('Team B Operations');
  });

  it('rejects protected fields and invalid blank names without mutation', async () => {
    const route = await import('../src/app/api/workspace/settings/route');
    const protectedFields = await route.PATCH(request('PATCH', {
      name: 'Tampered', adminId: 'admin-b', isActive: false, branding: { announcement: 'not allowed' },
    }));
    expect(protectedFields.status).toBe(400);
    expect(mocks.workspaceFindOneAndUpdate).not.toHaveBeenCalled();

    const blankName = await route.PATCH(request('PATCH', { name: '   ' }));
    expect(blankName.status).toBe(400);
    expect(mocks.workspaceFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.workspaces.a).toMatchObject({ name: 'Team A', adminId: 'admin-a', isActive: true });
  });

  it('renders a Workspace Settings name editor in the Admin dashboard', () => {
    const source = readFileSync(new URL('../src/components/admin-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Workspace Settings');
    expect(source).toContain("requestJson('/api/workspace/settings'");
    expect(source).toContain('Workspace name');
  });
});
