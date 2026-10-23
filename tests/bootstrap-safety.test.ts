import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => {
  const state = { hasSuperAdmin: false, accountConflict: false, aborted: false };
  const session = {
    withTransaction: vi.fn(async (callback: () => Promise<unknown>) => {
      const previousSuperAdminState = state.hasSuperAdmin;
      try {
        return await callback();
      } catch (error) {
        state.aborted = true;
        state.hasSuperAdmin = previousSuperAdminState;
        throw error;
      }
    }),
    endSession: vi.fn(async () => undefined),
  };

  return {
    state,
    session,
    connectDB: vi.fn(),
    hash: vi.fn(),
    startSession: vi.fn(),
    userFindOne: vi.fn(),
    userCreate: vi.fn(),
    userUpdateOne: vi.fn(),
    userDeleteOne: vi.fn(),
    workspaceCreate: vi.fn(),
    workspaceDeleteOne: vi.fn(),
    getSessionFromRequest: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ connectDB: mocks.connectDB }));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash } }));
vi.mock('@/lib/auth', () => ({ getSessionFromRequest: mocks.getSessionFromRequest }));
vi.mock('@/lib/models', () => ({
  User: {
    startSession: mocks.startSession,
    findOne: mocks.userFindOne,
    create: mocks.userCreate,
    updateOne: mocks.userUpdateOne,
    deleteOne: mocks.userDeleteOne,
  },
  Workspace: { create: mocks.workspaceCreate, deleteOne: mocks.workspaceDeleteOne },
}));

function query(value: unknown | (() => Promise<unknown>)) {
  const builder = {
    session: vi.fn(() => builder),
    select: vi.fn(() => builder),
    lean: vi.fn(async () => typeof value === 'function' ? value() : value),
  };
  return builder;
}

function configureEnvironment() {
  vi.stubEnv('BOOTSTRAP_SECRET', 'test-bootstrap-secret');
  vi.stubEnv('SUPER_ADMIN_NAME', 'Test Owner');
  vi.stubEnv('SUPER_ADMIN_USERNAME', 'testowner');
  vi.stubEnv('SUPER_ADMIN_EMAIL', 'owner@example.test');
  vi.stubEnv('SUPER_ADMIN_PASSWORD', 'test-password-long-enough');
}

function bootstrapRequest(secret = 'test-bootstrap-secret') {
  return new Request('https://app.example.test/api/setup/bootstrap', {
    method: 'POST',
    headers: { 'x-bootstrap-secret': secret },
  });
}

async function postBootstrap(secret?: string) {
  const route = await import('../src/app/api/setup/bootstrap/route');
  return route.POST(bootstrapRequest(secret));
}

describe('Super Admin bootstrap safety', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.state.hasSuperAdmin = false;
    mocks.state.accountConflict = false;
    mocks.state.aborted = false;
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.hash.mockResolvedValue('mock-password-hash');
    mocks.startSession.mockResolvedValue(mocks.session);
    mocks.userFindOne.mockImplementation((filter: Record<string, unknown>) => {
      if (filter.role === 'super-admin') return query(mocks.state.hasSuperAdmin ? { _id: 'existing-owner' } : null);
      return query(mocks.state.accountConflict ? { _id: 'existing-account' } : null);
    });
    mocks.userCreate.mockImplementation(async () => {
      mocks.state.hasSuperAdmin = true;
      return [{ _id: 'new-owner' }];
    });
    mocks.workspaceCreate.mockResolvedValue([{ _id: 'new-workspace' }]);
    mocks.userUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mocks.userDeleteOne.mockResolvedValue({ deletedCount: 0 });
    mocks.workspaceDeleteOne.mockResolvedValue({ deletedCount: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('rejects missing bootstrap-secret configuration before connecting', async () => {
    configureEnvironment();
    vi.stubEnv('BOOTSTRAP_SECRET', '');

    const response = await postBootstrap();

    expect(response.status).toBe(503);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });

  it('rejects an incorrect bootstrap secret before connecting', async () => {
    configureEnvironment();

    const response = await postBootstrap('incorrect-secret');

    expect(response.status).toBe(401);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });

  it('reports a sanitized failure category without logging the error message', async () => {
    configureEnvironment();
    const diagnostic = vi.mocked(console.error);
    mocks.connectDB.mockRejectedValue(new Error('private-connection-detail'));

    const response = await postBootstrap();

    expect(response.status).toBe(500);
    expect(diagnostic).toHaveBeenCalledWith('[bootstrap] Initial setup failed.', {
      phase: 'database-connection',
      errorName: 'Error',
      errorCode: undefined,
    });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-connection-detail');
  });

  it.each([
    ['missing required account configuration', 'SUPER_ADMIN_EMAIL', ''],
    ['a password shorter than twelve characters', 'SUPER_ADMIN_PASSWORD', 'short'],
  ])('rejects %s before connecting', async (_label, key, value) => {
    configureEnvironment();
    vi.stubEnv(key as 'SUPER_ADMIN_EMAIL' | 'SUPER_ADMIN_PASSWORD', value);

    const response = await postBootstrap();

    expect(response.status).toBe(503);
    expect(mocks.connectDB).not.toHaveBeenCalled();
  });

  it('returns conflict when a Super Admin already exists', async () => {
    configureEnvironment();
    mocks.state.hasSuperAdmin = true;

    const response = await postBootstrap();

    expect(response.status).toBe(409);
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.workspaceCreate).not.toHaveBeenCalled();
  });

  it('rejects an existing username or email before creating setup data', async () => {
    configureEnvironment();
    mocks.state.accountConflict = true;

    const response = await postBootstrap();

    expect(response.status).toBe(409);
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.workspaceCreate).not.toHaveBeenCalled();
  });

  it('creates the Super Admin and Workspace in one transaction session', async () => {
    configureEnvironment();

    const response = await postBootstrap();

    expect(response.status).toBe(201);
    expect(mocks.session.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.userCreate).toHaveBeenCalledWith([expect.objectContaining({ role: 'super-admin', workspaceId: null })], { session: mocks.session });
    expect(mocks.workspaceCreate).toHaveBeenCalledWith([expect.objectContaining({ adminId: 'new-owner' })], { session: mocks.session });
    expect(mocks.userUpdateOne).toHaveBeenCalledWith(
      { _id: 'new-owner' },
      { $set: { workspaceId: 'new-workspace' } },
      { session: mocks.session },
    );
    expect(mocks.session.endSession).toHaveBeenCalledOnce();
  });

  it('returns conflict on a later bootstrap attempt', async () => {
    configureEnvironment();

    expect((await postBootstrap()).status).toBe(201);
    const repeated = await postBootstrap();

    expect(repeated.status).toBe(409);
    expect(mocks.userCreate).toHaveBeenCalledOnce();
    expect(mocks.workspaceCreate).toHaveBeenCalledOnce();
  });

  it('returns conflict for a duplicate-key race on the unique Super Admin claim', async () => {
    configureEnvironment();
    mocks.userCreate.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: 11000 }));

    const response = await postBootstrap();

    expect(response.status).toBe(409);
    expect(mocks.state.aborted).toBe(true);
    expect(mocks.session.endSession).toHaveBeenCalledOnce();
  });

  it('allows only one of two concurrent mocked requests through the unique claim', async () => {
    configureEnvironment();
    let roleReads = 0;
    let releaseRoleReads!: () => void;
    const bothRoleReads = new Promise<void>((resolve) => { releaseRoleReads = resolve; });
    let claimInserted = false;
    mocks.userFindOne.mockImplementation((filter: Record<string, unknown>) => {
      if (filter.role !== 'super-admin') return query(null);
      roleReads += 1;
      return query(async () => {
        if (roleReads === 2) releaseRoleReads();
        await bothRoleReads;
        return null;
      });
    });
    mocks.userCreate.mockImplementation(async () => {
      if (claimInserted) throw Object.assign(new Error('duplicate key'), { code: 11000 });
      claimInserted = true;
      return [{ _id: 'new-owner' }];
    });

    const responses = await Promise.all([postBootstrap(), postBootstrap()]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(mocks.workspaceCreate).toHaveBeenCalledOnce();
  });

  it('declares a partial unique index for the single Super Admin role', () => {
    const source = readFileSync(new URL('../src/lib/models.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    const migrationSource = readFileSync(new URL('../src/lib/migrations.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

    expect(source).toContain("{ role: 1 },\n  { unique: true, partialFilterExpression: { role: 'super-admin' }, name: 'unique_super_admin_role' }");
    expect(migrationSource).toContain("{ model: User, fields: ['role'], match: { role: 'super-admin' } }");
  });

  it('does not return success or run manual cleanup if Workspace creation fails', async () => {
    configureEnvironment();
    mocks.workspaceCreate.mockRejectedValue(new Error('mock workspace failure'));

    const response = await postBootstrap();

    expect(response.status).toBe(500);
    expect(mocks.state.aborted).toBe(true);
    expect(mocks.state.hasSuperAdmin).toBe(false);
    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
    expect(mocks.userDeleteOne).not.toHaveBeenCalled();
    expect(mocks.workspaceDeleteOne).not.toHaveBeenCalled();
    expect(mocks.session.endSession).toHaveBeenCalledOnce();
  });

  it('does not return success if assigning the Workspace fails', async () => {
    configureEnvironment();
    mocks.userUpdateOne.mockRejectedValue(new Error('mock assignment failure'));

    const response = await postBootstrap();

    expect(response.status).toBe(500);
    expect(mocks.state.aborted).toBe(true);
    expect(mocks.state.hasSuperAdmin).toBe(false);
    expect(mocks.session.endSession).toHaveBeenCalledOnce();
  });

  it('aborts if the Workspace assignment update matches no Super Admin document', async () => {
    configureEnvironment();
    mocks.userUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    const response = await postBootstrap();

    expect(response.status).toBe(500);
    expect(mocks.state.aborted).toBe(true);
    expect(mocks.state.hasSuperAdmin).toBe(false);
    expect(mocks.session.endSession).toHaveBeenCalledOnce();
  });

  it('does not report success if transaction commit fails after the callback', async () => {
    configureEnvironment();
    mocks.session.withTransaction.mockImplementationOnce(async (callback) => {
      const previous = mocks.state.hasSuperAdmin;
      await callback();
      mocks.state.hasSuperAdmin = previous;
      mocks.state.aborted = true;
      throw new Error('mock transaction commit failure');
    });

    const response = await postBootstrap();

    expect(response.status).toBe(500);
    expect(mocks.state.aborted).toBe(true);
    expect(mocks.state.hasSuperAdmin).toBe(false);
    expect(mocks.session.endSession).toHaveBeenCalledOnce();
  });

  it('only permits a Super Admin to create Admin accounts', async () => {
    configureEnvironment();
    const route = await import('../src/app/api/admins/route');

    for (const role of ['admin', 'worker']) {
      mocks.getSessionFromRequest.mockResolvedValueOnce({ id: 'user-id', role, workspaceId: 'workspace-id' });
      const response = await route.POST(new Request('https://app.example.test/api/admins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }) as never);
      expect(response.status).toBe(403);
    }

    expect(mocks.connectDB).not.toHaveBeenCalled();
  });
});
