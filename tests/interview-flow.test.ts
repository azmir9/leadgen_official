import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const session = { id: 'worker-a', name: 'Worker A', email: 'worker-a@example.invalid', username: 'worker-a', role: 'worker' as string, workspaceId: 'workspace-a', status: 'active' };
  const tx = { withTransaction: vi.fn(), endSession: vi.fn() };
  return {
    session, tx, getSession: vi.fn(), connectDB: vi.fn(), findOne: vi.fn(), find: vi.fn(), count: vi.fn(), create: vi.fn(),
    userFind: vi.fn(), userFindOne: vi.fn(), userFindOneAndUpdate: vi.fn(), userUpdate: vi.fn(), userStartSession: vi.fn(), interviewUpdate: vi.fn(), auditCreate: vi.fn(),
  };
});

function query<T>(value: T) {
  const builder = {
    select: vi.fn(() => builder), sort: vi.fn(() => builder), skip: vi.fn(() => builder), limit: vi.fn(() => builder),
    session: vi.fn(() => builder), lean: vi.fn().mockResolvedValue(value),
  };
  return builder;
}

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSession }));
vi.mock('@/lib/csrf', () => ({ isSameOriginRequest: vi.fn(() => true) }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/worker-onboarding', () => ({ hashWorkerOnboardingToken: vi.fn(() => 'hashed-onboarding-token'), WORKER_ONBOARDING_COOKIE: 'leadgen_worker_onboarding' }));
vi.mock('@/lib/models', () => ({
  Interview: { findOne: mocks.findOne, find: mocks.find, countDocuments: mocks.count, create: mocks.create, updateOne: mocks.interviewUpdate },
  User: { find: mocks.userFind, findOne: mocks.userFindOne, findOneAndUpdate: mocks.userFindOneAndUpdate, updateOne: mocks.userUpdate, startSession: mocks.userStartSession },
  AuditLog: { create: mocks.auditCreate },
}));

import { GET, PATCH, POST } from '@/app/api/interviews/route';

function request(url: string, method: string, body?: unknown) {
  return new Request(url, { method, headers: { origin: 'https://app.example.invalid', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) as never;
}

const fullInterview = {
  category: 'lead-generation', experienceAmount: '0.5', experienceUnit: 'years', dailyLeadCapacity: '0',
  workArrangement: 'individual', platforms: ['Free Sites'], description: 'I research local business prospects.',
  contact: { contactNumber: '+880 1700-000000', facebook: '', whatsapp: '', telegram: '@worker_a', additional: '' },
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.session, { id: 'worker-a', name: 'Worker A', email: 'worker-a@example.invalid', username: 'worker-a', role: 'worker', workspaceId: 'workspace-a', status: 'active' });
  mocks.getSession.mockImplementation(async () => ({ ...mocks.session }));
  mocks.connectDB.mockResolvedValue(undefined);
  mocks.findOne.mockReturnValue(query(null));
  mocks.find.mockReturnValue(query([]));
  mocks.count.mockResolvedValue(0);
  mocks.userFind.mockReturnValue(query([{ _id: 'worker-a', name: 'Worker A', username: 'worker-a', email: 'worker-a@example.invalid', status: 'active' }]));
  mocks.userFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'worker-a', name: 'Worker A', username: 'worker-a', email: 'worker-a@example.invalid', workspaceId: 'workspace-a', status: 'pending', role: 'worker' }) }) });
  mocks.create.mockResolvedValue([{ _id: 'interview-a', revision: 1, status: 'pending_review', submittedAt: new Date('2026-01-01T00:00:00Z') }]);
  mocks.userStartSession.mockResolvedValue(mocks.tx);
  mocks.tx.withTransaction.mockImplementation(async (callback: () => Promise<unknown>) => callback());
  mocks.tx.endSession.mockResolvedValue(undefined);
  mocks.userUpdate.mockResolvedValue({ matchedCount: 1 });
  mocks.interviewUpdate.mockResolvedValue({ matchedCount: 1 });
  mocks.auditCreate.mockResolvedValue([]);
});

describe('Worker interview and approval flow', () => {
  it('validates the required category before touching persistence', async () => {
    const response = await POST(request('https://app.example.invalid/api/interviews', 'POST', { ...fullInterview, category: 'invented-category' }));
    expect(response.status).toBe(400);
    expect(mocks.connectDB).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('saves structured answers under the authenticated Worker and Workspace with pending review status', async () => {
    const response = await POST(request('https://app.example.invalid/api/interviews', 'POST', fullInterview));
    expect(response.status).toBe(201);
    expect(mocks.findOne).toHaveBeenCalledWith({ workspaceId: 'workspace-a', workerId: 'worker-a', service: 'lead-generation', status: 'reset' });
    expect(mocks.create).toHaveBeenCalledWith([expect.objectContaining({
      workspaceId: 'workspace-a', workerId: 'worker-a', service: 'lead-generation', category: 'lead-generation',
      experienceAmount: 0.5, experienceUnit: 'years', dailyLeadCapacity: 0, workArrangement: 'individual',
      platforms: ['Free Sites'], status: 'pending_review', contact: expect.objectContaining({ contactNumber: '+880 1700-000000', telegram: '@worker_a' }),
    })], { session: mocks.tx });
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ _id: 'worker-a', role: 'worker', workspaceId: 'workspace-a', status: { $in: ['pending', 'active'] } }), { $set: { primaryInterviewService: 'lead-generation' } }, { session: mocks.tx });
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain('onboarding-token');
  });

  it('rejects a concurrent different-category claim before creating another active interview', async () => {
    mocks.userUpdate.mockResolvedValueOnce({ matchedCount: 0 });
    const response = await POST(request('https://app.example.invalid/api/interviews', 'POST', { ...fullInterview, category: 'google-ads' }));
    expect(response.status).toBe(409);
    expect(mocks.userUpdate).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.tx.endSession).toHaveBeenCalledOnce();
  });

  it('returns only the authenticated Worker’s own interview records', async () => {
    mocks.find.mockReturnValue(query([{ _id: 'interview-a', workspaceId: 'workspace-a', workerId: 'worker-a', service: 'lead-generation', answers: {}, status: 'pending_review', submittedAt: new Date(), revision: 1 }]));
    const response = await GET(request('https://app.example.invalid/api/interviews?workspaceId=workspace-b', 'GET'));
    expect(response.status).toBe(200);
    expect(mocks.find).toHaveBeenCalledWith({ workspaceId: 'workspace-a', workerId: 'worker-a' });
    expect(mocks.userFind).toHaveBeenCalledWith({ _id: { $in: ['worker-a'] }, role: 'worker', workspaceId: 'workspace-a' });
  });

  it('accepts the short-lived onboarding cookie for a pending Worker and clears it after successful submission', async () => {
    mocks.getSession.mockResolvedValue(null);
    const onboardingRequest = new NextRequest('https://app.example.invalid/api/interviews?onboarding=1', {
      method: 'POST', headers: { origin: 'https://app.example.invalid', cookie: 'leadgen_worker_onboarding=safe-test-capability', 'content-type': 'application/json' },
      body: JSON.stringify(fullInterview),
    });
    const response = await POST(onboardingRequest);
    expect(response.status).toBe(201);
    expect(mocks.userFindOne).toHaveBeenCalledWith(expect.objectContaining({ role: 'worker', status: 'pending', onboardingTokenHash: 'hashed-onboarding-token' }));
    expect(mocks.userUpdate).toHaveBeenCalledWith({ _id: 'worker-a', role: 'worker', status: 'pending' }, { $unset: { onboardingTokenHash: 1, onboardingTokenExpiresAt: 1 } });
    expect(response.headers.get('set-cookie')).toContain('leadgen_worker_onboarding=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('rejects Admin attempts to read a different Workspace', async () => {
    mocks.session.role = 'admin';
    mocks.session.id = 'admin-a';
    const response = await GET(request('https://app.example.invalid/api/interviews?workspaceId=workspace-b', 'GET'));
    expect(response.status).toBe(403);
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('returns complete interview and contact details only to an Admin of the matching workspace', async () => {
    mocks.session.role = 'admin';
    mocks.session.id = 'admin-a';
    mocks.find.mockReturnValue(query([{ _id: 'interview-a', workspaceId: 'workspace-a', workerId: 'worker-a', service: 'lead-generation', category: 'lead-generation', experienceAmount: 0.5, experienceUnit: 'years', dailyLeadCapacity: 0, workArrangement: 'individual', platforms: ['Free Sites'], description: 'Prospect research', contact: { whatsapp: '+880 1700 000000' }, answers: {}, status: 'pending_review', submittedAt: new Date(), revision: 1 }]));
    const response = await GET(request('https://app.example.invalid/api/interviews?workspaceId=workspace-a', 'GET'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.interviews[0]).toMatchObject({ workerName: 'Worker A', workerEmail: 'worker-a@example.invalid', category: 'lead-generation', experienceAmount: 0.5, dailyLeadCapacity: 0, workArrangement: 'individual', platforms: ['Free Sites'], contact: { whatsapp: '+880 1700 000000' }, status: 'pending_review' });
  });

  it('approves only the pending Worker tied to the selected workspace interview and records an audit event', async () => {
    mocks.session.role = 'admin';
    mocks.session.id = 'admin-a';
    const interview = { _id: 'interview-a', workerId: 'worker-a', workspaceId: 'workspace-a', status: 'pending_review', service: 'lead-generation', category: 'lead-generation', experienceAmount: 0, experienceUnit: 'months', dailyLeadCapacity: 0, workArrangement: 'individual', answers: {}, revision: 1 };
    mocks.findOne.mockReturnValue(query(interview));
    const response = await PATCH(request('https://app.example.invalid/api/interviews', 'PATCH', { interviewId: 'interview-a', action: 'approve' }));
    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ _id: 'worker-a', role: 'worker', workspaceId: 'workspace-a', status: { $in: ['pending', 'inactive', 'blocked'] } }), expect.objectContaining({ $set: expect.objectContaining({ status: 'active', approvalRequired: false, approvedBy: 'admin-a', approvedAt: expect.any(Date) }) }), { session: mocks.tx });
    expect(mocks.interviewUpdate).toHaveBeenCalledWith({ _id: 'interview-a', workspaceId: 'workspace-a', workerId: 'worker-a', status: 'pending_review' }, { $set: expect.objectContaining({ status: 'approved', reviewedBy: 'admin-a' }) }, { session: mocks.tx });
    expect(mocks.auditCreate).toHaveBeenCalledWith([expect.objectContaining({ action: 'worker.approved_after_interview', workspaceId: 'workspace-a' })], { session: mocks.tx });
    expect(mocks.tx.endSession).toHaveBeenCalledOnce();
  });

  it('does not approve a pending Worker from an old incomplete interview format', async () => {
    mocks.session.role = 'admin';
    mocks.session.id = 'admin-a';
    mocks.findOne.mockReturnValue(query({ _id: 'legacy-interview', workerId: 'worker-a', workspaceId: 'workspace-a', status: 'submitted', service: 'seo', answers: {} }));
    const response = await PATCH(request('https://app.example.invalid/api/interviews', 'PATCH', { interviewId: 'legacy-interview', action: 'approve' }));
    expect(response.status).toBe(409);
    expect(mocks.userStartSession).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});
