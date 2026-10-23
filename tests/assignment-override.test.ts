import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: { assignments: [] as Record<string, unknown>[], auditLogs: [] as Record<string, unknown>[], workers: [] as Record<string, unknown>[], failInsert: false, failInsertAfterFirst: false, failAudit: false },
  session: {
    withTransaction: vi.fn(),
    endSession: vi.fn(),
  },
  getSessionFromRequest: vi.fn(),
  connectDB: vi.fn(),
  assignmentFind: vi.fn(),
  assignmentInsertMany: vi.fn(),
  assignmentUpdateOne: vi.fn(),
  assignmentStartSession: vi.fn(),
  userFindOne: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('@/lib/models', () => ({
  Assignment: {
    find: mocks.assignmentFind,
    insertMany: mocks.assignmentInsertMany,
    updateOne: mocks.assignmentUpdateOne,
    startSession: mocks.assignmentStartSession,
  },
  AuditLog: { create: mocks.auditCreate },
  User: { findOne: mocks.userFindOne },
}));

function query<T>(value: T) {
  const builder = {
    select: vi.fn(() => builder),
    session: vi.fn(() => builder),
    lean: vi.fn(async () => value),
  };
  return builder;
}

function matchesAssignment(assignment: Record<string, unknown>, filter: Record<string, unknown>) {
  if (assignment.workspaceId !== filter.workspaceId || assignment.status !== filter.status) return false;
  const usernames = filter.username as { $in: string[] };
  return usernames.$in.includes(String(assignment.username));
}

function request(body: Record<string, unknown>) {
  return new Request('https://app.example.test/api/assignments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.example.test' },
    body: JSON.stringify(body),
  }) as never;
}

async function post(body: Record<string, unknown>) {
  const route = await import('../src/app/api/assignments/route');
  return route.POST(request(body));
}

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    _id: `assignment-${mocks.state.assignments.length + 1}`,
    workspaceId: 'workspace-a',
    workerId: 'worker-old',
    username: 'lead-one',
    status: 'active',
    ...overrides,
  };
}

describe('assignment reassignment safety', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.state.assignments = [];
    mocks.state.auditLogs = [];
    mocks.state.workers = [{ _id: 'worker-new', role: 'worker', workspaceId: 'workspace-a', status: 'active' }];
    mocks.state.failInsert = false;
    mocks.state.failInsertAfterFirst = false;
    mocks.state.failAudit = false;
    mocks.getSessionFromRequest.mockResolvedValue({ id: 'admin-a', role: 'admin', workspaceId: 'workspace-a' });
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.assignmentStartSession.mockResolvedValue(mocks.session);
    mocks.session.withTransaction.mockImplementation(async (callback: () => Promise<unknown>) => {
      const oldAssignments = structuredClone(mocks.state.assignments);
      const oldAuditLogs = structuredClone(mocks.state.auditLogs);
      try {
        return await callback();
      } catch (error) {
        mocks.state.assignments = oldAssignments;
        mocks.state.auditLogs = oldAuditLogs;
        throw error;
      }
    });
    mocks.assignmentFind.mockImplementation((filter: Record<string, unknown>) => query(
      mocks.state.assignments.filter((item) => matchesAssignment(item, filter)),
    ));
    mocks.userFindOne.mockImplementation((filter: Record<string, unknown>) => query(
      mocks.state.workers.find((worker) => worker._id === filter._id
        && worker.role === filter.role
        && worker.workspaceId === filter.workspaceId
        && worker.status === filter.status) || null,
    ));
    mocks.assignmentUpdateOne.mockImplementation(async (filter: Record<string, unknown>) => {
      const found = mocks.state.assignments.find((item) => item._id === filter._id
        && item.workspaceId === filter.workspaceId
        && item.workerId === filter.workerId
        && item.status === filter.status);
      if (!found) return { matchedCount: 0, modifiedCount: 0 };
      found.status = 'inactive';
      return { matchedCount: 1, modifiedCount: 1 };
    });
    mocks.assignmentInsertMany.mockImplementation(async (rows: Record<string, unknown>[], _options?: Record<string, unknown>) => {
      void _options;
      if (mocks.state.failInsert) throw new Error('mock assignment insert failure');
      const created = rows.map((row, index) => ({ ...row, _id: `created-${mocks.state.assignments.length}-${index}` }));
      if (mocks.state.failInsertAfterFirst && created.length > 1) {
        mocks.state.assignments.push(created[0]);
        throw new Error('mock later assignment insert failure');
      }
      mocks.state.assignments.push(...created);
      return created;
    });
    mocks.auditCreate.mockImplementation(async (docs: Record<string, unknown>[] | Record<string, unknown>) => {
      if (mocks.state.failAudit) throw new Error('mock audit failure');
      const entries = Array.isArray(docs) ? docs : [docs];
      mocks.state.auditLogs.push(...entries);
      return entries;
    });
  });

  it('keeps normal assignment behavior and records its audit', async () => {
    const response = await post({ workerId: 'worker-new', usernames: 'lead-one' });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ success: true, inserted: 1, duplicates: [], reassignmentsRequired: [] });
    expect(mocks.state.assignments).toHaveLength(1);
    expect(mocks.state.assignments[0]).toMatchObject({ workerId: 'worker-new', status: 'active', username: 'lead-one' });
    expect(mocks.state.auditLogs).toHaveLength(1);
    expect(mocks.session.withTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.assignmentInsertMany.mock.calls[0][1]).toMatchObject({ ordered: true, session: mocks.session });
    expect(mocks.auditCreate.mock.calls[0][1]).toEqual({ session: mocks.session });
  });

  it('keeps duplicate-driven partial success while auditing the accepted batch atomically', async () => {
    mocks.state.assignments.push(assignment({ username: 'already-assigned' }));
    const response = await post({ workerId: 'worker-new', usernames: 'already-assigned\nnew-lead' });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ success: true, inserted: 1, duplicates: ['already-assigned'] });
    expect(mocks.state.assignments.filter((item) => item.status === 'active')).toHaveLength(2);
    expect(mocks.state.assignments.some((item) => item.username === 'new-lead' && item.workerId === 'worker-new')).toBe(true);
    expect(mocks.state.auditLogs).toHaveLength(1);
  });

  it('rolls back all normal batch inserts if the audit write fails', async () => {
    mocks.state.failAudit = true;

    const response = await post({ workerId: 'worker-new', usernames: 'lead-one\nlead-two' });

    expect(response.status).toBe(500);
    expect(mocks.state.assignments).toHaveLength(0);
    expect(mocks.state.auditLogs).toHaveLength(0);
  });

  it('rolls back earlier normal batch inserts if a later insert fails', async () => {
    mocks.state.failInsertAfterFirst = true;

    const response = await post({ workerId: 'worker-new', usernames: 'lead-one\nlead-two' });

    expect(response.status).toBe(500);
    expect(mocks.state.assignments).toHaveLength(0);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('rejects a duplicate active assignment without override and makes no writes', async () => {
    mocks.state.assignments.push(assignment());

    const response = await post({ workerId: 'worker-new', usernames: 'lead-one' });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ requiresOverrideConfirmation: true, reassignmentsRequired: [{ username: 'lead-one', workerId: 'worker-old' }] });
    expect(mocks.state.assignments).toHaveLength(1);
    expect(mocks.assignmentInsertMany).not.toHaveBeenCalled();
    expect(mocks.state.auditLogs).toHaveLength(0);
  });

  it('confirms reassignment, preserves the old row, and writes one active assignment plus audit in one transaction', async () => {
    mocks.state.assignments.push(assignment());
    const preview = await post({ workerId: 'worker-new', usernames: 'lead-one' });
    const previewBody = await preview.json();
    const response = await post({
      workerId: 'worker-new',
      usernames: 'lead-one',
      override: true,
      expectedAssignments: previewBody.reassignmentsRequired,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, reassigned: ['lead-one'] });
    expect(mocks.state.assignments).toHaveLength(2);
    expect(mocks.state.assignments[0]).toMatchObject({ workerId: 'worker-old', status: 'inactive' });
    expect(mocks.state.assignments[1]).toMatchObject({ workerId: 'worker-new', status: 'active' });
    expect(mocks.state.assignments.filter((item) => item.status === 'active')).toHaveLength(1);
    expect(mocks.assignmentUpdateOne.mock.calls[0][2]).toEqual({ session: mocks.session });
    expect(mocks.auditCreate.mock.calls.at(-1)?.[1]).toEqual({ session: mocks.session });
    expect(mocks.state.auditLogs.at(-1)).toMatchObject({ action: 'assignments.reassigned', details: { reassigned: [{ username: 'lead-one', fromWorkerId: 'worker-old', toWorkerId: 'worker-new' }] } });
  });

  it('rejects unauthorized roles, cross-workspace Admin requests, and Workers outside the Admin workspace', async () => {
    mocks.getSessionFromRequest.mockResolvedValueOnce({ id: 'worker-id', role: 'worker', workspaceId: 'workspace-a' });
    const unauthorized = await post({ workerId: 'worker-new', usernames: 'lead-one' });
    expect(unauthorized.status).toBe(403);

    const crossWorkspace = await post({ workerId: 'worker-new', usernames: 'lead-one', workspaceId: 'workspace-b' });
    expect(crossWorkspace.status).toBe(403);

    const foreignWorker = await post({ workerId: 'worker-foreign', usernames: 'lead-one' });
    expect(foreignWorker.status).toBe(404);
    expect(mocks.assignmentInsertMany).not.toHaveBeenCalled();
  });

  it('rolls back the old assignment if the new assignment insert fails', async () => {
    mocks.state.assignments.push(assignment());
    mocks.state.failInsert = true;

    const response = await post({ workerId: 'worker-new', usernames: 'lead-one', override: true, expectedAssignments: [{ username: 'lead-one', workerId: 'worker-old' }] });

    expect(response.status).toBe(500);
    expect(mocks.state.assignments).toHaveLength(1);
    expect(mocks.state.assignments[0]).toMatchObject({ workerId: 'worker-old', status: 'active' });
    expect(mocks.state.auditLogs).toHaveLength(0);
  });

  it('rolls back reassignment if the audit write fails', async () => {
    mocks.state.assignments.push(assignment());
    mocks.state.failAudit = true;

    const response = await post({ workerId: 'worker-new', usernames: 'lead-one', override: true, expectedAssignments: [{ username: 'lead-one', workerId: 'worker-old' }] });

    expect(response.status).toBe(500);
    expect(mocks.state.assignments).toHaveLength(1);
    expect(mocks.state.assignments[0]).toMatchObject({ workerId: 'worker-old', status: 'active' });
    expect(mocks.state.auditLogs).toHaveLength(0);
  });

  it('rejects a repeated stale confirmation without creating another active assignment', async () => {
    mocks.state.assignments.push(assignment());
    const confirmation = { workerId: 'worker-new', usernames: 'lead-one', override: true, expectedAssignments: [{ username: 'lead-one', workerId: 'worker-old' }] };
    expect((await post(confirmation)).status).toBe(200);
    const repeated = await post(confirmation);

    expect(repeated.status).toBe(409);
    expect(mocks.state.assignments.filter((item) => item.status === 'active')).toHaveLength(1);
    expect(mocks.state.assignments.find((item) => item.status === 'active')).toMatchObject({ workerId: 'worker-new' });
    expect(mocks.state.auditLogs).toHaveLength(1);
  });

  it('renders an explicit reassignment confirmation in the Admin UI', () => {
    const source = readFileSync(new URL('../src/components/admin-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Confirm reassignment');
    expect(source).toContain('expectedAssignments: reassignmentConfirmation.assignments');
    expect(source).toContain('only the new active assignee can access their reports');
  });
});
