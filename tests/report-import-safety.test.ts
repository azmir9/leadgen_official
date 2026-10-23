import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startWorkerReportPolling } from '../src/lib/worker-report-refresh';

const mocks = vi.hoisted(() => {
  const state = { aborted: false };
  const transactionSession = {
    withTransaction: vi.fn(async (callback: () => Promise<unknown>) => {
      try { return await callback(); } catch (error) { state.aborted = true; throw error; }
    }),
    endSession: vi.fn(),
  };
  return {
    state,
    transactionSession,
    getSessionFromRequest: vi.fn(),
    connectDB: vi.fn(),
    reportFind: vi.fn(),
    reportCreate: vi.fn(),
    reportUpdateOne: vi.fn(),
    reportStartSession: vi.fn(),
    assignmentFind: vi.fn(),
    auditCreate: vi.fn(),
    historyFind: vi.fn(),
    historyCreate: vi.fn(),
  };
});

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  Assignment: { find: mocks.assignmentFind },
  OfficialReport: {
    find: mocks.reportFind,
    create: mocks.reportCreate,
    updateOne: mocks.reportUpdateOne,
    startSession: mocks.reportStartSession,
  },
  AuditLog: { create: mocks.auditCreate },
  OfficialReportHistory: { find: mocks.historyFind, create: mocks.historyCreate },
}));

function query<T>(value: T) {
  const builder = {
    select: vi.fn(() => builder),
    session: vi.fn(() => builder),
    sort: vi.fn(() => builder),
    distinct: vi.fn(async () => Array.isArray(value) ? value.map((item) => typeof item === 'object' && item !== null && 'username' in item ? item.username : item) : []),
    lean: vi.fn().mockResolvedValue(value),
  };
  return builder;
}

function importRequest(data: string, overwrite = false) {
  return new Request('https://app.example.test/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.example.test' },
    body: JSON.stringify({ action: 'import', date: '2026-10-10', data, overwrite }),
  }) as never;
}

async function postImport(data: string, overwrite = false) {
  const route = await import('../src/app/api/reports/route');
  return route.POST(importRequest(data, overwrite));
}

type MockAssignment = { workspaceId: string; workerId: string; username: string; status: string };
type MockStoredReport = { workspaceId: string; reportDate: string; normalizedUsername: string; reportValue: number };

async function getWorkerReports(
  workerId: string,
  workspaceId: string,
  assignments: MockAssignment[],
  storedReports: MockStoredReport[],
  reportDate = '2026-10-10',
) {
  mocks.getSessionFromRequest.mockResolvedValue({ id: workerId, role: 'worker', workspaceId });
  mocks.assignmentFind.mockImplementation((filter: { workspaceId: string; workerId: string; status: string }) => query(
    assignments.filter((assignment) => assignment.workspaceId === filter.workspaceId
      && assignment.workerId === filter.workerId
      && assignment.status === filter.status),
  ));
  mocks.reportFind.mockImplementation((filter: { workspaceId: string; reportDate: string; normalizedUsername: { $in: string[] } }) => query(
    storedReports.filter((report) => report.workspaceId === filter.workspaceId
      && report.reportDate === filter.reportDate
      && filter.normalizedUsername.$in.includes(report.normalizedUsername)),
  ));

  const route = await import('../src/app/api/reports/route');
  return route.GET(new Request(`https://app.example.test/api/reports?date=${encodeURIComponent(reportDate)}`) as never);
}

describe('report import safety', () => {
  it('rejects impossible calendar dates before database access', async () => {
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'admin-id', role: 'admin', workspaceId: 'workspace-a' });
    const route = await import('../src/app/api/reports/route');
    const response = await route.GET(new Request('https://app.example.test/api/reports?date=2026-02-30') as never);
    expect(response.status).toBe(400);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.state.aborted = false;
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'admin-id', role: 'admin', workspaceId: 'workspace-a' });
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.reportStartSession.mockResolvedValue(mocks.transactionSession);
    mocks.reportFind.mockReturnValue(query([]));
    mocks.assignmentFind.mockReturnValue(query([{ username: 'assigned-user' }]));
    mocks.reportCreate.mockResolvedValue([]);
    mocks.reportUpdateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
    mocks.auditCreate.mockResolvedValue([]);
    mocks.historyFind.mockReturnValue(query([]));
    mocks.historyCreate.mockResolvedValue([]);
  });

  it('skips unassigned rows and reports the skipped count', async () => {
    const response = await postImport('assigned-user 4\nunassigned-user 9');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, inserted: 1, updated: 0, skippedUnassigned: 1 });
    expect(mocks.reportCreate).toHaveBeenCalledTimes(1);
    expect(mocks.reportCreate.mock.calls[0][0][0].normalizedUsername).toBe('assigned-user');
    expect(mocks.auditCreate.mock.calls[0][0][0].details.skippedUnassigned).toBe(1);
  });

  it('includes the skipped count in preview data and the Admin UI', async () => {
    const route = await import('../src/app/api/reports/route');
    const response = await route.POST(new Request('https://app.example.test/api/reports', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.example.test' },
      body: JSON.stringify({ action: 'preview', date: '2026-10-10', data: 'assigned-user 4\nunassigned-user 9' }),
    }) as never);
    const body = await response.json();
    const uiSource = readFileSync(new URL('../src/components/admin-workspace.tsx', import.meta.url), 'utf8');

    expect(body.summary).toMatchObject({ new: 1, skippedUnassigned: 1 });
    expect(uiSource).toContain('preview.summary.skippedUnassigned ?? preview.summary.unassigned');
    expect(uiSource).toContain('result.skippedUnassigned');
    expect(uiSource).toContain('setPreview(result); setOverwrite(false)');
  });

  it('rejects a cross-origin import before any connection or state change', async () => {
    const route = await import('../src/app/api/reports/route');
    const response = await route.POST(new Request('https://app.example.test/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example.test' },
      body: JSON.stringify({ action: 'import', date: '2026-10-10', data: 'assigned-user 4', overwrite: true }),
    }) as never);

    expect(response.status).toBe(403);
    expect(mocks.connectDB).not.toHaveBeenCalled();
    expect(mocks.reportStartSession).not.toHaveBeenCalled();
    expect(mocks.reportCreate).not.toHaveBeenCalled();
    expect(mocks.reportUpdateOne).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('shows the corrected value on an already-open Worker report poll for the selected date', async () => {
    const storedReports: { workspaceId: string; reportDate: string; normalizedUsername: string; reportValue: number; uploadedBy: string }[] = [];
    mocks.reportFind.mockImplementation(() => query(storedReports));
    mocks.reportCreate.mockImplementation(async (documents: typeof storedReports) => {
      storedReports.push(...documents);
      return documents;
    });
    mocks.reportUpdateOne.mockImplementation(async (_filter: unknown, update: { $set: { reportValue: number } }) => {
      if (storedReports[0]) storedReports[0].reportValue = update.$set.reportValue;
      return { acknowledged: true, modifiedCount: storedReports.length ? 1 : 0 };
    });

    const imported = await postImport('assigned-user 4');
    expect(imported.status).toBe(200);

    mocks.getSessionFromRequest.mockResolvedValue({ id: 'worker-id', role: 'worker', workspaceId: 'workspace-a' });
    const reportRoute = await import('../src/app/api/reports/route');
    const firstResponse = await reportRoute.GET(new Request('https://app.example.test/api/reports?date=2026-10-10') as never);
    expect((await firstResponse.json()).reports).toEqual([{ username: 'assigned-user', reportValue: 4 }]);
    let displayedReports: { username: string; reportValue: number | null }[] = [];
    let poll: (() => void) | undefined;
    const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const scheduler = { setInterval: vi.fn((callback: () => void) => { poll = callback; return 1; }), clearInterval: vi.fn() };
    const refresh = async (_signal: AbortSignal, isActive: () => boolean) => {
      const response = await reportRoute.GET(new Request('https://app.example.test/api/reports?date=2026-10-10') as never);
      const result = await response.json();
      if (isActive()) displayedReports = result.reports;
    };
    const polling = startWorkerReportPolling(refresh, { documentTarget, scheduler: scheduler as unknown as Window });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(displayedReports).toEqual([{ username: 'assigned-user', reportValue: 4 }]);

    mocks.getSessionFromRequest.mockResolvedValue({ id: 'admin-id', role: 'admin', workspaceId: 'workspace-a' });
    const corrected = await postImport('assigned-user 9', true);
    expect(corrected.status).toBe(200);
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'worker-id', role: 'worker', workspaceId: 'workspace-a' });
    poll?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(displayedReports).toEqual([{ username: 'assigned-user', reportValue: 9 }]);
    polling.stop();
  });

  it('allows the current active assignee to read the username report', async () => {
    const response = await getWorkerReports('worker-current', 'workspace-a', [
      { workspaceId: 'workspace-a', workerId: 'worker-current', username: 'assigned-user', status: 'active' },
    ], [
      { workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: 'assigned-user', reportValue: 6 },
    ]);

    expect(response.status).toBe(200);
    expect((await response.json()).reports).toEqual([{ username: 'assigned-user', reportValue: 6 }]);
    expect(mocks.assignmentFind).toHaveBeenCalledWith({ workspaceId: 'workspace-a', workerId: 'worker-current', status: 'active' });
  });

  it('calculates a Worker total only from displayed reports, never another Worker’s report', async () => {
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'worker-current', role: 'worker', workspaceId: 'workspace-a' });
    mocks.assignmentFind.mockReturnValue(query([
      { username: 'assigned-user' },
      { username: 'assigned-zero' },
    ]));
    // Simulate a broad query result to ensure response aggregation is restricted to authorized rows.
    mocks.reportFind.mockReturnValue(query([
      { workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: 'assigned-user', reportValue: 6 },
      { workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: 'assigned-zero', reportValue: 0 },
      { workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: 'other-workers-user', reportValue: 900 },
    ]));

    const route = await import('../src/app/api/reports/route');
    const response = await route.GET(new Request('https://app.example.test/api/reports?date=2026-10-10') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reports).toEqual([
      { username: 'assigned-user', reportValue: 6 },
      { username: 'assigned-zero', reportValue: 0 },
    ]);
    expect(body.total).toBe(6);
    expect(JSON.stringify(body)).not.toContain('other-workers-user');
    expect(JSON.stringify(body)).not.toContain('900');
  });

  it('reads Worker assignments and reports in the same read-only transaction', async () => {
    const assignmentQuery = query([{ username: 'assigned-user' }]);
    const reportQuery = query([{ normalizedUsername: 'assigned-user', reportValue: 3 }]);
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'worker-current', role: 'worker', workspaceId: 'workspace-a' });
    mocks.assignmentFind.mockReturnValue(assignmentQuery);
    mocks.reportFind.mockReturnValue(reportQuery);

    const route = await import('../src/app/api/reports/route');
    const response = await route.GET(new Request('https://app.example.test/api/reports?date=2026-10-10') as never);

    expect(response.status).toBe(200);
    expect(assignmentQuery.session).toHaveBeenCalledWith(mocks.transactionSession);
    expect(reportQuery.session).toHaveBeenCalledWith(mocks.transactionSession);
    expect(mocks.reportStartSession).toHaveBeenCalledTimes(1);
    expect(mocks.transactionSession.withTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.transactionSession.endSession).toHaveBeenCalledTimes(1);
  });

  it('does not let an inactive assignment expose its username report', async () => {
    const response = await getWorkerReports('worker-former', 'workspace-a', [
      { workspaceId: 'workspace-a', workerId: 'worker-former', username: 'assigned-user', status: 'inactive' },
    ], [
      { workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: 'assigned-user', reportValue: 6 },
    ]);

    expect(response.status).toBe(200);
    expect((await response.json()).reports).toEqual([]);
  });

  it('limits a reassigned username report to its current active assignee', async () => {
    const assignments = [
      { workspaceId: 'workspace-a', workerId: 'worker-former', username: 'assigned-user', status: 'inactive' },
      { workspaceId: 'workspace-a', workerId: 'worker-current', username: 'assigned-user', status: 'active' },
    ];
    const storedReports = [
      { workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: 'assigned-user', reportValue: 6 },
    ];

    const formerWorkerResponse = await getWorkerReports('worker-former', 'workspace-a', assignments, storedReports);
    expect((await formerWorkerResponse.json()).reports).toEqual([]);

    const currentWorkerResponse = await getWorkerReports('worker-current', 'workspace-a', assignments, storedReports);
    expect((await currentWorkerResponse.json()).reports).toEqual([{ username: 'assigned-user', reportValue: 6 }]);
  });

  it('does not expose another workspace assignment or report', async () => {
    const response = await getWorkerReports('worker-current', 'workspace-a', [
      { workspaceId: 'workspace-b', workerId: 'worker-current', username: 'other-workspace-user', status: 'active' },
    ], [
      { workspaceId: 'workspace-b', reportDate: '2026-10-10', normalizedUsername: 'other-workspace-user', reportValue: 12 },
    ]);

    expect(response.status).toBe(200);
    expect((await response.json()).reports).toEqual([]);
    expect(mocks.assignmentFind).toHaveBeenCalledWith({ workspaceId: 'workspace-a', workerId: 'worker-current', status: 'active' });
  });

  it('keeps zero-valued reports distinct from missing reports', async () => {
    const response = await getWorkerReports('worker-current', 'workspace-a', [
      { workspaceId: 'workspace-a', workerId: 'worker-current', username: 'zero-user', status: 'active' },
      { workspaceId: 'workspace-a', workerId: 'worker-current', username: 'missing-user', status: 'active' },
    ], [
      { workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: 'zero-user', reportValue: 0 },
    ]);

    const reports = (await response.json()).reports;
    expect(reports).toHaveLength(2);
    expect(reports).toEqual(expect.arrayContaining([
      { username: 'missing-user', reportValue: null },
      { username: 'zero-user', reportValue: 0 },
    ]));
  });

  it('returns history for the selected date and limits it to current active assignments', async () => {
    const response = await getWorkerReports('worker-current', 'workspace-a', [
      { workspaceId: 'workspace-a', workerId: 'worker-current', username: 'assigned-user', status: 'active' },
    ], [
      { workspaceId: 'workspace-a', reportDate: '2026-10-09', normalizedUsername: 'assigned-user', reportValue: 5 },
      { workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: 'assigned-user', reportValue: 8 },
      { workspaceId: 'workspace-b', reportDate: '2026-10-09', normalizedUsername: 'assigned-user', reportValue: 99 },
    ], '2026-10-09');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      date: '2026-10-09',
      reports: [{ username: 'assigned-user', reportValue: 5 }],
    });
    expect(mocks.reportFind).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-a',
      reportDate: '2026-10-09',
      normalizedUsername: { $in: ['assigned-user'] },
    }));
  });

  it('returns an empty history when there are no current active assignments', async () => {
    const response = await getWorkerReports('worker-current', 'workspace-a', [
      { workspaceId: 'workspace-a', workerId: 'worker-current', username: 'former-user', status: 'inactive' },
    ], [
      { workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: 'former-user', reportValue: 7 },
    ]);

    expect(response.status).toBe(200);
    expect((await response.json()).reports).toEqual([]);
    expect(mocks.reportFind).not.toHaveBeenCalled();
    expect(mocks.reportStartSession).toHaveBeenCalledTimes(1);
  });

  it('performs no report or audit writes when every row is unassigned', async () => {
    mocks.assignmentFind.mockReturnValue(query([]));
    const response = await postImport('first-user 4\nsecond-user 9');
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ inserted: 0, updated: 0, skippedUnassigned: 2 });
    expect(body.message).toMatch(/No assigned report rows/);
    expect(mocks.reportCreate).not.toHaveBeenCalled();
    expect(mocks.reportUpdateOne).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('revalidates current assignments and existing reports inside the import transaction', async () => {
    const assignmentQuery = query([{ username: 'assigned-user' }]);
    const reportQuery = query([{ normalizedUsername: 'assigned-user', reportValue: 2 }]);
    mocks.assignmentFind.mockReturnValue(assignmentQuery);
    mocks.reportFind.mockReturnValue(reportQuery);

    const response = await postImport('assigned-user 4\nno-longer-assigned 8', true);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ inserted: 0, updated: 1, skippedUnassigned: 1 });
    expect(mocks.assignmentFind).toHaveBeenCalledWith({ workspaceId: 'workspace-a', status: 'active', username: { $in: ['assigned-user', 'no-longer-assigned'] } });
    expect(mocks.reportFind).toHaveBeenCalledWith({ workspaceId: 'workspace-a', reportDate: '2026-10-10', normalizedUsername: { $in: ['assigned-user', 'no-longer-assigned'] } });
    expect(assignmentQuery.session).toHaveBeenCalledWith(mocks.transactionSession);
    expect(reportQuery.session).toHaveBeenCalledWith(mocks.transactionSession);
  });

  it('requires overwrite confirmation for currently assigned existing rows', async () => {
    mocks.reportFind.mockReturnValue(query([{ normalizedUsername: 'assigned-user', reportValue: 2 }]));
    const response = await postImport('assigned-user 4');
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ requiresOverwriteConfirmation: true, summary: { updates: 1, skippedUnassigned: 0 } });
    expect(mocks.reportCreate).not.toHaveBeenCalled();
    expect(mocks.reportUpdateOne).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('uses one transaction session for report writes and the correction audit', async () => {
    mocks.reportFind.mockReturnValue(query([{ normalizedUsername: 'assigned-user', reportValue: 2 }]));
    const response = await postImport('assigned-user 4', true);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, updated: 1 });
    expect(mocks.reportUpdateOne.mock.calls[0][2]).toEqual({ session: mocks.transactionSession });
    expect(mocks.auditCreate.mock.calls[0][1]).toEqual({ session: mocks.transactionSession });
    expect(mocks.auditCreate.mock.calls[0][0][0].details.corrections).toEqual([{ username: 'assigned-user', before: 2, after: 4 }]);
  });

  it('does not return success if a report write fails', async () => {
    mocks.reportCreate.mockRejectedValue(new Error('mock report write failure'));

    await expect(postImport('assigned-user 4')).rejects.toThrow('mock report write failure');
    expect(mocks.state.aborted).toBe(true);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.transactionSession.endSession).toHaveBeenCalled();
  });

  it('does not return success if the audit write fails', async () => {
    mocks.auditCreate.mockRejectedValue(new Error('mock audit write failure'));

    await expect(postImport('assigned-user 4')).rejects.toThrow('mock audit write failure');
    expect(mocks.state.aborted).toBe(true);
    expect(mocks.reportCreate).toHaveBeenCalledTimes(1);
    expect(mocks.transactionSession.endSession).toHaveBeenCalled();
  });
});
