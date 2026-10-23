import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: { id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' },
  getSession: vi.fn(), connectDB: vi.fn(), userFindOne: vi.fn(), userFindOneAndUpdate: vi.fn(), auditCreate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSession }));
vi.mock('@/lib/csrf', () => ({ isSameOriginRequest: vi.fn(() => true) }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  User: { findOne: mocks.userFindOne, findOneAndUpdate: mocks.userFindOneAndUpdate },
  AuditLog: { create: mocks.auditCreate },
}));

import { PATCH } from '@/app/api/workers/route';

function request(body: Record<string, unknown>) {
  return new Request('https://app.example.invalid/api/workers', { method: 'PATCH', headers: { origin: 'https://app.example.invalid', 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ ...mocks.session });
  mocks.connectDB.mockResolvedValue(undefined);
  mocks.userFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ status: 'pending', approvalRequired: true }) }) });
  mocks.userFindOneAndUpdate.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'worker-a', name: 'Worker A', username: 'worker-a', status: 'inactive' }) }) });
  mocks.auditCreate.mockResolvedValue([]);
});

describe('Worker approval cannot bypass interview review', () => {
  it('rejects direct activation of a pending Worker', async () => {
    const response = await PATCH(request({ workerId: 'worker-a', status: 'active' }));
    expect(response.status).toBe(409);
    expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('keeps a pending Worker pending instead of letting status controls bypass interview approval', async () => {
    const response = await PATCH(request({ workerId: 'worker-a', status: 'inactive' }));
    expect(response.status).toBe(409);
    expect(mocks.userFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
