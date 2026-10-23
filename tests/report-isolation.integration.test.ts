import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getSessionFromRequest: authMock.session }));

const TEST_URI = process.env.TEST_MONGODB_URI?.trim() || '';
const disposableTestDbConfirmed = process.env.LEADGEN_CONFIRM_DISPOSABLE_TEST_DB === 'true';
const integration = describe.skipIf(!TEST_URI || !disposableTestDbConfirmed);
let models: typeof import('../src/lib/models');
let reportRoute: typeof import('../src/app/api/reports/route');
let dailyOrdersRoute: typeof import('../src/app/api/orders/daily-overview/route');
let workspaceA = '';
let workspaceB = '';
let userIds: string[] = [];

function validatedLocalTestUri(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('TEST_MONGODB_URI must be a valid MongoDB URI.'); }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) throw new Error('TEST_MONGODB_URI must use MongoDB protocol.');
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)) throw new Error('Integration tests only allow a local MongoDB host.');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^leadgen-test-[a-z0-9-]+$/i.test(databaseName)) throw new Error('Integration tests require a dedicated database named leadgen-test-<suffix>.');
  if (parsed.searchParams.has('dbName')) throw new Error('TEST_MONGODB_URI must not override its explicit database name.');
  if (['proxyHost', 'proxyPort', 'proxyUsername', 'proxyPassword'].some((option) => parsed.searchParams.has(option))) throw new Error('TEST_MONGODB_URI must not configure a network proxy.');
  return value;
}

function makeRequest(url: string) {
  return new Request(url) as never;
}

integration('MongoDB report and daily order isolation (dedicated local database only)', () => {
  beforeAll(async () => {
    const uri = validatedLocalTestUri(TEST_URI);
    process.env.MONGODB_URI = uri;
    process.env.MONGOOSE_AUTO_INDEX = 'false';
    const db = await import('../src/lib/db');
    await db.connectDB();
    models = await import('../src/lib/models');
    reportRoute = await import('../src/app/api/reports/route');
    dailyOrdersRoute = await import('../src/app/api/orders/daily-overview/route');

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    workspaceA = `integration-a-${suffix}`;
    workspaceB = `integration-b-${suffix}`;
    const workerSpecs = [
      { name: 'Worker A', username: `ia-${suffix}`, email: `ia-${suffix}@test.invalid`, workspaceId: workspaceA },
      { name: 'Worker B', username: `ib-${suffix}`, email: `ib-${suffix}@test.invalid`, workspaceId: workspaceA },
      { name: 'Worker C', username: `ic-${suffix}`, email: `ic-${suffix}@test.invalid`, workspaceId: workspaceB },
    ];
    const workers = await models.User.create(workerSpecs.map((worker) => ({ ...worker, passwordHash: 'test-only-unusable-hash', role: 'worker', status: 'active' })));
    userIds = workers.map((worker: { _id: unknown }) => String(worker._id));
    await models.Assignment.create([
      { workspaceId: workspaceA, workerId: userIds[0], assignedBy: 'test-admin', username: 'alpha-report', status: 'active' },
      { workspaceId: workspaceA, workerId: userIds[0], assignedBy: 'test-admin', username: 'zero-report', status: 'active' },
      { workspaceId: workspaceA, workerId: userIds[0], assignedBy: 'test-admin', username: 'missing-report', status: 'active' },
      { workspaceId: workspaceA, workerId: userIds[1], assignedBy: 'test-admin', username: 'beta-report', status: 'active' },
      { workspaceId: workspaceB, workerId: userIds[2], assignedBy: 'test-admin', username: 'gamma-report', status: 'active' },
    ]);
    await models.OfficialReport.create([
      { workspaceId: workspaceA, reportDate: '2026-10-10', normalizedUsername: 'alpha-report', reportValue: 12, uploadedBy: 'test-admin' },
      { workspaceId: workspaceA, reportDate: '2026-10-10', normalizedUsername: 'zero-report', reportValue: 0, uploadedBy: 'test-admin' },
      { workspaceId: workspaceA, reportDate: '2026-10-10', normalizedUsername: 'beta-report', reportValue: 700, uploadedBy: 'test-admin' },
      { workspaceId: workspaceB, reportDate: '2026-10-10', normalizedUsername: 'gamma-report', reportValue: 900, uploadedBy: 'test-admin' },
    ]);
    await models.UserOrder.create([
      { workspaceId: workspaceA, workerId: userIds[0], requestedQuantity: 10, deliveredQuantity: 3, pendingQuantity: 7, status: 'partially_fulfilled', requestDate: new Date('2026-10-10T02:00:00Z') },
      { workspaceId: workspaceA, workerId: userIds[0], requestedQuantity: 2, deliveredQuantity: 2, pendingQuantity: 0, status: 'fulfilled', requestDate: new Date('2026-10-10T03:00:00Z') },
      { workspaceId: workspaceA, workerId: userIds[1], requestedQuantity: 5, deliveredQuantity: 0, pendingQuantity: 5, status: 'pending', requestDate: new Date('2026-10-10T04:00:00Z') },
      { workspaceId: workspaceB, workerId: userIds[2], requestedQuantity: 100, deliveredQuantity: 0, pendingQuantity: 100, status: 'pending', requestDate: new Date('2026-10-10T04:00:00Z') },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (models && mongoose.connection.readyState === 1) {
      await Promise.all([
        models.User.deleteMany({ _id: { $in: userIds } }),
        models.Assignment.deleteMany({ workspaceId: { $in: [workspaceA, workspaceB] } }),
        models.OfficialReport.deleteMany({ workspaceId: { $in: [workspaceA, workspaceB] } }),
        models.UserOrder.deleteMany({ workspaceId: { $in: [workspaceA, workspaceB] } }),
      ]);
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }, 60_000);

  it('returns each Worker only their assigned reports and computes isolated totals', async () => {
    authMock.session.mockResolvedValue({ id: userIds[0], role: 'worker', workspaceId: workspaceA });
    const workerAResponse = await reportRoute.GET(makeRequest('http://localhost/api/reports?date=2026-10-10'));
    const workerA = await workerAResponse.json();
    expect(workerAResponse.status).toBe(200);
    expect(workerA.reports).toEqual([
      { username: 'alpha-report', reportValue: 12 },
      { username: 'missing-report', reportValue: null },
      { username: 'zero-report', reportValue: 0 },
    ]);
    expect(workerA.total).toBe(12);
    expect(JSON.stringify(workerA)).not.toContain('beta-report');
    expect(JSON.stringify(workerA)).not.toContain('700');

    authMock.session.mockResolvedValue({ id: userIds[1], role: 'worker', workspaceId: workspaceA });
    const workerBResponse = await reportRoute.GET(makeRequest('http://localhost/api/reports?date=2026-10-10'));
    const workerB = await workerBResponse.json();
    expect(workerB.reports).toEqual([{ username: 'beta-report', reportValue: 700 }]);
    expect(workerB.total).toBe(700);
    expect(JSON.stringify(workerB)).not.toContain('alpha-report');
  });

  it('isolates workspaces and denies Admin requests outside their own workspace', async () => {
    authMock.session.mockResolvedValue({ id: userIds[0], role: 'worker', workspaceId: workspaceA });
    const workerResponse = await reportRoute.GET(makeRequest(`http://localhost/api/reports?date=2026-10-10&workspaceId=${workspaceB}`));
    const workerBody = await workerResponse.json();
    expect(workerBody.total).toBe(12);
    expect(JSON.stringify(workerBody)).not.toContain('gamma-report');
    expect(JSON.stringify(workerBody)).not.toContain('900');

    authMock.session.mockResolvedValue({ id: 'test-admin-a', role: 'admin', workspaceId: workspaceA });
    const adminResponse = await reportRoute.GET(makeRequest(`http://localhost/api/reports?date=2026-10-10&workspaceId=${workspaceB}`));
    expect(adminResponse.status).toBe(403);
  });

  it('uses Dhaka business-day boundaries and reports daily fulfillment by active Worker', async () => {
    authMock.session.mockResolvedValue({ id: 'test-admin-a', role: 'admin', workspaceId: workspaceA });
    const response = await dailyOrdersRoute.GET(makeRequest(`http://localhost/api/orders/daily-overview?date=2026-10-10&workspaceId=${workspaceB}`));
    expect(response.status).toBe(403);
    const ownResponse = await dailyOrdersRoute.GET(makeRequest(`http://localhost/api/orders/daily-overview?date=2026-10-10&workspaceId=${workspaceA}`));
    const body = await ownResponse.json();
    expect(body).toMatchObject({ eligibleWorkers: 2, orderedWorkers: 2, workersWithoutOrders: 0, totalOrdered: 17, totalFulfilled: 5, totalPending: 12 });
    expect(body.workers.find((worker: { id: string }) => worker.id === userIds[0])).toMatchObject({ ordered: 12, fulfilled: 5, pending: 7 });
  });
});
