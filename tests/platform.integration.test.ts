import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const jwtSecret = 'test-jwt-secret-not-for-production-0123456789abcdef';
const bootstrapSecret = 'test-bootstrap-secret-0123456789abcdef';
const testMongoUri = process.env.TEST_MONGODB_URI?.trim() || '';
const runPlatformIntegration = process.env.RUN_PLATFORM_INTEGRATION_TESTS === 'true';
const disposableTestDbConfirmed = process.env.LEADGEN_CONFIRM_DISPOSABLE_TEST_DB === 'true';
let connectDB: typeof import('../src/lib/db').connectDB;
let createServerSession: typeof import('../src/lib/auth').createServerSession;
let models: typeof import('../src/lib/models');
let bootstrapRoute: typeof import('../src/app/api/setup/bootstrap/route');
let loginRoute: typeof import('../src/app/api/auth/login/route');
let registerRoute: typeof import('../src/app/api/auth/register/route');
let adminsRoute: typeof import('../src/app/api/admins/route');
let adminRoute: typeof import('../src/app/api/admins/[adminId]/route');
let joiningLinkRoute: typeof import('../src/app/api/admins/[adminId]/joining-link/route');
let workersRoute: typeof import('../src/app/api/workers/route');
let assignmentsRoute: typeof import('../src/app/api/assignments/route');
let ordersRoute: typeof import('../src/app/api/orders/route');
let reportsRoute: typeof import('../src/app/api/reports/route');
let approvalsRoute: typeof import('../src/app/api/lead-approvals/route');
let ratesRoute: typeof import('../src/app/api/daily-rates/route');
let paymentsRoute: typeof import('../src/app/api/payments/route');
let paymentPreviewRoute: typeof import('../src/app/api/payments/preview/route');
let paymentItemRoute: typeof import('../src/app/api/payments/[paymentId]/route');
let interviewsRoute: typeof import('../src/app/api/interviews/route');
let cmsRoute: typeof import('../src/app/api/cms/route');
let cmsItemRoute: typeof import('../src/app/api/cms/[contentId]/route');
let companyRoute: typeof import('../src/app/api/company/route');
let resetPasswordRoute: typeof import('../src/app/api/auth/reset-password/route');
let forgotPasswordRoute: typeof import('../src/app/api/auth/forgot-password/route');
let sessionRoute: typeof import('../src/app/api/auth/session/route');
let enforceRateLimit: typeof import('../src/lib/rate-limit').enforceRateLimit;

function makeRequest(url: string, method = 'GET', body?: unknown, token?: string) {
  return new NextRequest(url, {
    method,
    headers: {
      origin: new URL(url).origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { cookie: `leadgen_session=${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json(response: Response) {
  return response.json();
}

async function createSession(userId: string) {
  const user = await models.User.findById(userId).lean();
  if (!user) throw new Error('Test user missing.');
  const session = await createServerSession({
    id: String(user._id), name: user.name, email: user.email, username: user.username,
    role: user.role, workspaceId: user.workspaceId || null, status: user.status,
    sessionVersion: user.sessionVersion || 0,
  }, false);
  return session.token;
}

const context = (id: string) => ({ params: Promise.resolve({ adminId: id }) });
const paymentContext = (id: string) => ({ params: Promise.resolve({ paymentId: id }) });
const cmsContext = (id: string) => ({ params: Promise.resolve({ contentId: id }) });

function validateDedicatedTestUri(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('TEST_MONGODB_URI must be a valid MongoDB URI.'); }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) throw new Error('TEST_MONGODB_URI must use MongoDB protocol.');
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)) throw new Error('Platform integration tests only allow a local MongoDB host.');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^leadgen-test-[a-z0-9-]+$/i.test(databaseName)) throw new Error('Platform integration tests require a dedicated leadgen-test-<suffix> database.');
  if (parsed.searchParams.has('dbName')) throw new Error('TEST_MONGODB_URI must not override its explicit database name.');
  if (['proxyHost', 'proxyPort', 'proxyUsername', 'proxyPassword'].some((option) => parsed.searchParams.has(option))) throw new Error('TEST_MONGODB_URI must not configure a network proxy.');
  return value;
}

const integration = describe.skipIf(!testMongoUri || !runPlatformIntegration || !disposableTestDbConfirmed);

integration('Leadgen Official tenant and operations integration', () => {
beforeAll(async () => {
  process.env.JWT_SECRET = jwtSecret;
  process.env.BOOTSTRAP_SECRET = bootstrapSecret;
  process.env.SUPER_ADMIN_NAME = 'Test Owner';
  process.env.SUPER_ADMIN_USERNAME = 'testowner';
  process.env.SUPER_ADMIN_EMAIL = 'owner@test.example';
  process.env.SUPER_ADMIN_PASSWORD = 'TestOwner!Password12345';
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;

  process.env.MONGODB_URI = validateDedicatedTestUri(testMongoUri);
  process.env.MONGOOSE_AUTO_INDEX = 'false';

  const [db, auth, loadedModels, rateLimit, bootstrap, login, register, admins, admin, joining, workers, assignments, orders, reports, approvals, rates, payments, preview, paymentItem, interviews, cms, cmsItem, company, forgot, reset, session] = await Promise.all([
    import('../src/lib/db'), import('../src/lib/auth'), import('../src/lib/models'), import('../src/lib/rate-limit'),
    import('../src/app/api/setup/bootstrap/route'), import('../src/app/api/auth/login/route'), import('../src/app/api/auth/register/route'),
    import('../src/app/api/admins/route'), import('../src/app/api/admins/[adminId]/route'), import('../src/app/api/admins/[adminId]/joining-link/route'),
    import('../src/app/api/workers/route'), import('../src/app/api/assignments/route'), import('../src/app/api/orders/route'), import('../src/app/api/reports/route'),
    import('../src/app/api/lead-approvals/route'), import('../src/app/api/daily-rates/route'), import('../src/app/api/payments/route'),
    import('../src/app/api/payments/preview/route'), import('../src/app/api/payments/[paymentId]/route'), import('../src/app/api/interviews/route'),
    import('../src/app/api/cms/route'), import('../src/app/api/cms/[contentId]/route'), import('../src/app/api/company/route'),
    import('../src/app/api/auth/forgot-password/route'), import('../src/app/api/auth/reset-password/route'), import('../src/app/api/auth/session/route'),
  ]);
  connectDB = db.connectDB;
  createServerSession = auth.createServerSession;
  enforceRateLimit = rateLimit.enforceRateLimit;
  models = loadedModels;
  bootstrapRoute = bootstrap; loginRoute = login; registerRoute = register; adminsRoute = admins; adminRoute = admin;
  joiningLinkRoute = joining; workersRoute = workers; assignmentsRoute = assignments; ordersRoute = orders; reportsRoute = reports;
  approvalsRoute = approvals; ratesRoute = rates; paymentsRoute = payments; paymentPreviewRoute = preview; paymentItemRoute = paymentItem;
  interviewsRoute = interviews; cmsRoute = cms; cmsItemRoute = cmsItem; companyRoute = company; forgotPasswordRoute = forgot; resetPasswordRoute = reset; sessionRoute = session;
  await connectDB();
  const { ensureDatabaseIndexes } = await import('../src/lib/migrations');
  await ensureDatabaseIndexes();
}, 120_000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});

  it('bootstraps, enforces workspaces, and completes core operational workflows', async () => {
    const boot = await bootstrapRoute.POST(new Request('http://localhost/api/setup/bootstrap', { method: 'POST', headers: { 'x-bootstrap-secret': bootstrapSecret, 'content-type': 'application/json' }, body: '{}' }));
    expect(boot.status).toBe(201);
    expect((await bootstrapRoute.POST(new Request('http://localhost/api/setup/bootstrap', { method: 'POST', headers: { 'x-bootstrap-secret': bootstrapSecret }, body: '{}' }))).status).toBe(409);
    expect(await enforceRateLimit('test-bucket', 'unique-rate-test', 2, 60_000)).toBeNull();
    expect(await enforceRateLimit('test-bucket', 'unique-rate-test', 2, 60_000)).toBeNull();
    expect((await enforceRateLimit('test-bucket', 'unique-rate-test', 2, 60_000))?.status).toBe(429);

    const owner = await models.User.findOne({ role: 'super-admin' }).lean();
    const ownerSession = await createSession(String(owner!._id));
    const loginResponse = await loginRoute.POST(new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'testowner', email: 'owner@test.example', password: 'TestOwner!Password12345', rememberMe: true }) }));
    expect(loginResponse.status).toBe(200);
    const loginCookie = loginResponse.headers.get('set-cookie') || '';
    expect(loginCookie).toContain('Max-Age=2592000');

    const createAdmin = async (name: string, username: string, email: string) => {
      const response = await adminsRoute.POST(makeRequest('http://localhost/api/admins', 'POST', { name, username, email, password: 'Admin!Password12345', workspaceName: `${name} Workspace` }, ownerSession));
      expect(response.status).toBe(201);
      return (await json(response)).admin as { id: string; workspaceId: string };
    };
    const adminA = await createAdmin('Admin A', 'admina', 'admina@test.example');
    const adminB = await createAdmin('Admin B', 'adminb', 'adminb@test.example');
    const adminASession = await createSession(adminA.id);
    const adminBSession = await createSession(adminB.id);

    const issueLink = async (adminId: string, session: string) => {
      const response = await joiningLinkRoute.POST(makeRequest(`http://localhost/api/admins/${adminId}/joining-link`, 'POST', {}, session), context(adminId));
      expect(response.status).toBe(201);
      return (await json(response)).link.url as string;
    };
    const inviteA = new URL(await issueLink(adminA.id, ownerSession)).searchParams.get('invite')!;
    const inviteB = new URL(await issueLink(adminB.id, ownerSession)).searchParams.get('invite')!;
    expect(inviteA).not.toBe(inviteB);

    const registerWorker = async (name: string, username: string, email: string, invitationToken: string) => {
      const response = await registerRoute.POST(new Request('http://localhost/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, username, email, password: 'Worker!Password12345', confirmPassword: 'Worker!Password12345', invitationToken }) }));
      expect(response.status).toBe(201);
      expect((await json(response)).pendingApproval).toBe(true);
      const user = await models.User.findOne({ username }).lean();
      return { user: user!, id: String(user!._id), session: await createSession(String(user!._id)) };
    };
    const workerA = await registerWorker('Worker A', 'workera', 'workera@test.example', inviteA);
    const workerB = await registerWorker('Worker B', 'workerb', 'workerb@test.example', inviteB);
    expect(workerA.user.workspaceId).toBe(adminA.workspaceId);
    expect(workerB.user.workspaceId).toBe(adminB.workspaceId);

    const publicRegistration = await registerRoute.POST(new Request('http://localhost/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Public Worker', username: 'publicworker', email: 'public@test.example', password: 'Worker!Password12345', confirmPassword: 'Worker!Password12345' }) }));
    expect(publicRegistration.status).toBe(201);
    const publicWorker = await models.User.findOne({ username: 'publicworker' }).lean();
    expect(publicWorker?.workspaceId).toBe(owner!.workspaceId);

    const approve = await workersRoute.PATCH(makeRequest('http://localhost/api/workers', 'PATCH', { workerId: workerA.id, status: 'active' }, adminASession));
    expect(approve.status).toBe(200);
    await models.User.updateOne({ _id: workerA.id }, { $set: { paymentAccounts: { bKash: '01700000001', Nagad: '01700000002', Rocket: '01700000003' } } });
    const staleWorkerSession = workerA.session;
    workerA.session = await createSession(workerA.id);

    const forbiddenWorkers = await workersRoute.GET(new NextRequest(`http://localhost/api/workers?workspaceId=${adminB.workspaceId}`, { headers: { cookie: `leadgen_session=${adminASession}` } }));
    expect(forbiddenWorkers.status).toBe(403);
    expect((await paymentsRoute.GET(new NextRequest(`http://localhost/api/payments?workspaceId=${adminB.workspaceId}`, { headers: { cookie: `leadgen_session=${adminASession}` } }))).status).toBe(403);
    expect((await reportsRoute.GET(new NextRequest(`http://localhost/api/reports?workspaceId=${owner!.workspaceId}&date=2026-10-10`, { headers: { cookie: `leadgen_session=${adminASession}` } }))).status).toBe(403);
    expect((await companyRoute.PUT(makeRequest('http://localhost/api/company', 'PUT', { companyName: 'Tampered' }, adminASession))).status).toBe(403);
    expect((await companyRoute.PUT(makeRequest('http://localhost/api/company', 'PUT', { companyName: 'Leadgen Official Test' }, ownerSession))).status).toBe(200);
    expect((await json(await companyRoute.GET())).companyName).toBe('Leadgen Official Test');

    const assigned = await assignmentsRoute.POST(makeRequest('http://localhost/api/assignments', 'POST', { workerId: workerA.id, usernames: 'lead001\nlead002' }, adminASession));
    expect(assigned.status).toBe(201);
    const duplicateAssignment = await assignmentsRoute.POST(makeRequest('http://localhost/api/assignments', 'POST', { workerId: workerA.id, usernames: 'LEAD001' }, adminASession));
    expect(duplicateAssignment.status).toBe(409);

    const orderResponse = await ordersRoute.POST(makeRequest('http://localhost/api/orders', 'POST', { quantity: 10 }, workerA.session));
    const order = (await json(orderResponse)).order;
    expect(orderResponse.status).toBe(201);
    const deliveryResponse = await ordersRoute.PATCH(makeRequest('http://localhost/api/orders', 'PATCH', { orderId: order.id, deliveredQuantity: 8 }, adminASession));
    expect(deliveryResponse.status).toBe(200);
    expect((await json(deliveryResponse)).order.pendingQuantity).toBe(2);

    const reportDate = '2026-10-10';
    const importResponse = await reportsRoute.POST(makeRequest('http://localhost/api/reports', 'POST', { action: 'import', date: reportDate, data: 'lead001\t10\nlead002\t5' }, adminASession));
    expect(importResponse.status).toBe(200);
    expect((await json(importResponse)).inserted).toBe(2);
    expect((await reportsRoute.POST(makeRequest('http://localhost/api/reports', 'POST', { action: 'import', date: reportDate, data: 'lead001\t11' }, adminASession))).status).toBe(409);
    const correction = await reportsRoute.POST(makeRequest('http://localhost/api/reports', 'POST', { action: 'import', date: reportDate, data: 'lead001\t11', overwrite: true }, adminASession));
    expect(correction.status).toBe(200);
    expect((await json(correction)).updated).toBe(1);
    const reportPreview = await reportsRoute.GET(new NextRequest(`http://localhost/api/reports?date=${reportDate}`, { headers: { cookie: `leadgen_session=${workerA.session}` } }));
    expect((await json(reportPreview)).total).toBe(16);
    const dateIsolation = await reportsRoute.GET(new NextRequest('http://localhost/api/reports?date=2026-10-11', { headers: { cookie: `leadgen_session=${workerA.session}` } }));
    expect((await json(dateIsolation)).total).toBe(0);

    const approvalResponse = await approvalsRoute.POST(makeRequest('http://localhost/api/lead-approvals', 'POST', { date: reportDate, items: [{ username: 'lead001', approvedLeads: 8, rejectedLeads: 2 }, { username: 'lead002', approvedLeads: 5, rejectedLeads: 0, adjustmentAmount: 1.5, adjustmentReason: 'Manual correction' }] }, adminASession));
    expect(approvalResponse.status).toBe(200);
    const rateResponse = await ratesRoute.POST(makeRequest('http://localhost/api/daily-rates', 'POST', { date: '2026-10-01', ratePerLead: 2, currency: 'BDT' }, adminASession));
    expect(rateResponse.status).toBe(201);

    const previewResponse = await paymentPreviewRoute.POST(makeRequest('http://localhost/api/payments/preview', 'POST', { workerId: workerA.id, reportDates: [reportDate] }, adminASession));
    expect(previewResponse.status).toBe(200);
    const preview = await json(previewResponse);
    expect(preview.payableAmount).toBe(27.5);
    const paymentResponse = await paymentsRoute.POST(makeRequest('http://localhost/api/payments', 'POST', { workerId: workerA.id, reportDates: [reportDate], paymentMethod: 'bKash' }, adminASession));
    expect(paymentResponse.status).toBe(201);
    const payment = await json(paymentResponse);
    const duplicatePayment = await paymentsRoute.POST(makeRequest('http://localhost/api/payments', 'POST', { workerId: workerA.id, reportDates: [reportDate], paymentMethod: 'bKash' }, adminASession));
    expect(duplicatePayment.status).toBe(409);
    const globalPayments = await paymentsRoute.GET(new NextRequest('http://localhost/api/payments?limit=50', { headers: { cookie: `leadgen_session=${ownerSession}` } }));
    expect((await json(globalPayments)).payments).toHaveLength(1);
    const workerPayments = await paymentsRoute.GET(new NextRequest('http://localhost/api/payments', { headers: { cookie: `leadgen_session=${workerA.session}` } }));
    expect((await json(workerPayments)).payments).toHaveLength(1);
    expect((await paymentItemRoute.PATCH(makeRequest(`http://localhost/api/payments/${payment.paymentId}`, 'PATCH', { status: 'paid', transactionReference: 'TX-TEST-1' }, adminASession), paymentContext(payment.paymentId))).status).toBe(200);

    const interviewResponse = await interviewsRoute.POST(makeRequest('http://localhost/api/interviews', 'POST', { service: 'seo', answers: { 'SEO experience': 'Technical audits', 'Search intent': 'Review SERP and query context' } }, workerA.session));
    expect(interviewResponse.status).toBe(201);
    const interview = (await json(interviewResponse)).interview;
    expect((await interviewsRoute.POST(makeRequest('http://localhost/api/interviews', 'POST', { service: 'seo', answers: { Q: 'repeat' } }, workerA.session))).status).toBe(409);
    expect((await interviewsRoute.PATCH(makeRequest('http://localhost/api/interviews', 'PATCH', { interviewId: interview.id, action: 'reset' }, adminASession))).status).toBe(200);
    expect((await interviewsRoute.POST(makeRequest('http://localhost/api/interviews', 'POST', { service: 'seo', answers: { 'SEO experience': 'New attempt' } }, workerA.session))).status).toBe(200);

    expect((await cmsRoute.POST(makeRequest('http://localhost/api/cms', 'POST', { type: 'blog', title: 'Tenant Safety', slug: 'tenant-safety', summary: 'Workspace privacy', content: 'Keep tenants isolated.', status: 'published' }, adminASession))).status).toBe(403);
    const cmsResponse = await cmsRoute.POST(makeRequest('http://localhost/api/cms', 'POST', { type: 'blog', title: 'Tenant Safety', slug: 'tenant-safety', summary: 'Workspace privacy', content: 'Keep tenants isolated.', status: 'published' }, ownerSession));
    expect(cmsResponse.status).toBe(201);
    expect((await cmsRoute.GET(new NextRequest('http://localhost/api/cms?type=blog'))).status).toBe(200);
    const cmsId = (await json(cmsResponse)).item.id;
    expect((await cmsRoute.PUT(makeRequest('http://localhost/api/cms', 'PUT', { id: cmsId, type: 'blog', title: 'Tenant Safety Updated', slug: 'tenant-safety', summary: 'Updated privacy', content: 'Keep every workspace isolated.', status: 'published' }, ownerSession))).status).toBe(200);
    expect((await cmsItemRoute.DELETE(makeRequest(`http://localhost/api/cms/${cmsId}`, 'DELETE', undefined, ownerSession), cmsContext(cmsId))).status).toBe(200);

    const expiredToken = 'A'.repeat(43);
    const resetTokenHash = createHash('sha256').update(expiredToken).digest('hex');
    await models.PasswordReset.create({ userId: workerA.id, tokenHash: resetTokenHash, expiresAt: new Date(Date.now() + 60_000) });
    const resetResult = await resetPasswordRoute.POST(new Request('http://localhost/api/auth/reset-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: expiredToken, password: 'NewWorker!Password12345', confirmPassword: 'NewWorker!Password12345' }) }));
    expect(resetResult.status).toBe(200);
    expect((await resetPasswordRoute.POST(new Request('http://localhost/api/auth/reset-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: expiredToken, password: 'NewWorker!Password12345', confirmPassword: 'NewWorker!Password12345' }) }))).status).toBe(400);
    const staleSession = await sessionRoute.GET(new NextRequest('http://localhost/api/auth/session', { headers: { cookie: `leadgen_session=${staleWorkerSession}` } }));
    expect((await json(staleSession)).session).toBeNull();

    const forgotResponse = await forgotPasswordRoute.POST(new Request('http://localhost/api/auth/forgot-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'workera@test.example' }) }));
    expect(forgotResponse.status).toBe(503);
    expect(await json(forgotResponse)).not.toHaveProperty('token');

    const rotatedLinkResponse = await joiningLinkRoute.POST(makeRequest(`http://localhost/api/admins/${adminA.id}/joining-link`, 'POST', {}, ownerSession), context(adminA.id));
    const rotatedUrl = new URL((await json(rotatedLinkResponse)).link.url);
    const revokedToken = inviteA;
    await joiningLinkRoute.DELETE(makeRequest(`http://localhost/api/admins/${adminA.id}/joining-link`, 'DELETE', undefined, ownerSession), context(adminA.id));
    const revokedRegistration = await registerRoute.POST(new Request('http://localhost/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Revoked', username: 'revokedworker', email: 'revoked@test.example', password: 'Worker!Password12345', confirmPassword: 'Worker!Password12345', invitationToken: revokedToken }) }));
    expect(revokedRegistration.status).toBe(400);
    expect(rotatedUrl.searchParams.has('invite')).toBe(true);

    const expiringLinkResponse = await joiningLinkRoute.POST(makeRequest(`http://localhost/api/admins/${adminA.id}/joining-link`, 'POST', { expiresInDays: 1 }, ownerSession), context(adminA.id));
    const expiringToken = new URL((await json(expiringLinkResponse)).link.url).searchParams.get('invite')!;
    await models.JoinLink.updateOne({ tokenHash: createHash('sha256').update(expiringToken).digest('hex') }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredRegistration = await registerRoute.POST(new Request('http://localhost/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Expired', username: 'expiredworker', email: 'expired@test.example', password: 'Worker!Password12345', confirmPassword: 'Worker!Password12345', invitationToken: expiringToken }) }));
    expect(expiredRegistration.status).toBe(400);

    await workersRoute.PATCH(makeRequest('http://localhost/api/workers', 'PATCH', { workerId: workerB.id, status: 'active' }, adminBSession));
    const workerBActiveSession = await createSession(workerB.id);
    await workersRoute.PATCH(makeRequest('http://localhost/api/workers', 'PATCH', { workerId: workerB.id, status: 'blocked' }, adminBSession));
    const blockedSession = await sessionRoute.GET(new NextRequest('http://localhost/api/auth/session', { headers: { cookie: `leadgen_session=${workerBActiveSession}` } }));
    expect((await json(blockedSession)).session).toBeNull();

    expect((await adminRoute.PATCH(makeRequest(`http://localhost/api/admins/${adminA.id}`, 'PATCH', { status: 'inactive' }, ownerSession), context(adminA.id))).status).toBe(200);
    expect((await loginRoute.POST(new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admina', email: 'admina@test.example', password: 'Admin!Password12345' }) }))).status).toBe(403);
    expect((await adminRoute.PATCH(makeRequest(`http://localhost/api/admins/${adminA.id}`, 'PATCH', { status: 'active' }, ownerSession), context(adminA.id))).status).toBe(200);
  });
});
