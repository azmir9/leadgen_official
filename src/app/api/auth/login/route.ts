import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createServerSession } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { enforceRateLimit, missingClientIdentityResponse, requestIdentity } from '@/lib/rate-limit';
import { User } from '@/lib/models';
import { Interview } from '@/lib/models';
import { createWorkerOnboardingToken, WORKER_ONBOARDING_COOKIE } from '@/lib/worker-onboarding';
import { createAuthDiagnosticContext, logAuthDiagnosticFailure, runAuthDiagnosticStage } from '@/lib/auth-diagnostics';

export async function POST(request: Request) {
  const diagnostics = createAuthDiagnosticContext('login_request');
  try {
    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 });
    }
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return NextResponse.json({ message: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const body = parsedBody as Record<string, unknown>;
    const username = String(body.username || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const login = String(body.login || '').trim().toLowerCase();
    const password = String(body.password || '');
    const rememberMe = body.rememberMe === true || body.rememberMe === 'true';

    if ((!login && (!username || !email)) || !password) {
      return NextResponse.json({ message: 'Username, email, and password are required.' }, { status: 400 });
    }

    const identity = login || username || email;
    const clientIdentity = requestIdentity(request);
    if (!clientIdentity) {
      return missingClientIdentityResponse('login_rate_limit_ip', 'Sign-in is temporarily unavailable. Please try again later.', diagnostics.requestId);
    }
    const ipLimit = await enforceRateLimit('login-ip', clientIdentity, 15, 15 * 60 * 1000, {
      context: diagnostics,
      connectStage: 'login_rate_limit_ip_connect',
      bucketStage: 'login_rate_limit_ip_bucket',
      retryStage: 'login_rate_limit_ip_retry',
    });
    if (ipLimit) return ipLimit;
    const accountLimit = await enforceRateLimit('login-account', identity, 8, 15 * 60 * 1000, {
      context: diagnostics,
      connectStage: 'login_rate_limit_account_connect',
      bucketStage: 'login_rate_limit_account_bucket',
      retryStage: 'login_rate_limit_account_retry',
    });
    if (accountLimit) return accountLimit;

    await runAuthDiagnosticStage(diagnostics, 'login_database_connect', () => connectDB(diagnostics));

    const user = await runAuthDiagnosticStage(diagnostics, 'login_user_lookup', () => username && email
      ? User.findOne({ username, email }).lean()
      : User.findOne({ $or: [{ username: login }, { email: login }] }).lean());

    if (!user) {
      return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    const match = await runAuthDiagnosticStage(diagnostics, 'login_password_verify', () => bcrypt.compare(password, user.passwordHash));
    if (!match) {
      return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    if (user.status === 'pending' && user.role === 'worker' && user.workspaceId) {
      const existingInterview = await runAuthDiagnosticStage(diagnostics, 'login_pending_worker_interview_lookup', () =>
        Interview.findOne({ workspaceId: user.workspaceId, workerId: String(user._id), status: { $in: ['pending_review', 'submitted', 'reviewed', 'approved'] } }).select('_id').lean());
      if (!existingInterview) {
        const onboarding = createWorkerOnboardingToken();
        const update = await runAuthDiagnosticStage(diagnostics, 'login_pending_worker_onboarding_token', () => User.updateOne(
          { _id: user._id, role: 'worker', status: 'pending', workspaceId: user.workspaceId },
          { $set: { onboardingTokenHash: onboarding.tokenHash, onboardingTokenExpiresAt: onboarding.expiresAt } },
        ));
        if (update.matchedCount === 1) {
          const response = NextResponse.json({ success: true, pendingApproval: true, redirectTo: '/interview', message: 'Your account is pending approval. Complete your interview to continue.' });
          response.cookies.set(WORKER_ONBOARDING_COOKIE, onboarding.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', expires: onboarding.expiresAt, path: '/' });
          response.cookies.set('leadgen_session', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 0, path: '/' });
          return response;
        }
      }
      return NextResponse.json({ success: true, pendingApproval: true, message: existingInterview ? 'Your interview is awaiting Admin review. Worker dashboard access begins after approval.' : 'Your account status changed. Please try again.' });
    }

    if (user.status !== 'active') {
      return NextResponse.json({ message: 'Your account is pending, inactive, or blocked.' }, { status: 403 });
    }

    const safeUser = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      workspaceId: user.workspaceId || null,
      status: user.status,
      sessionVersion: user.sessionVersion || 0,
    };

    const serverSession = await runAuthDiagnosticStage(
      diagnostics,
      'login_session_create',
      () => createServerSession(safeUser, rememberMe, diagnostics),
    );
    if (user.role === 'admin') {
      try { await User.updateOne({ _id: user._id, role: 'admin', status: 'active' }, { $set: { lastActiveAt: new Date() } }); }
      catch { /* A successfully created session remains valid if presence recording is unavailable. */ }
    }
    const response = NextResponse.json({ success: true, user: safeUser }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set('leadgen_session', serverSession.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      ...(serverSession.maxAge ? { maxAge: serverSession.maxAge } : {}),
      path: '/',
    });
    response.cookies.set(WORKER_ONBOARDING_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 0, path: '/' });

    return response;
  } catch (error) {
    logAuthDiagnosticFailure(diagnostics, error);
    return NextResponse.json({ message: 'Unable to sign in right now.' }, { status: 500 });
  }
}
