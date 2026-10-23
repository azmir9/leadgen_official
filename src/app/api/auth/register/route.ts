import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createWorkerOnboardingToken, WORKER_ONBOARDING_COOKIE } from '@/lib/worker-onboarding';
import { connectDB } from '@/lib/db';
import { hashInvitationToken } from '@/lib/invitations';
import { enforceRateLimit, missingClientIdentityResponse, requestIdentity } from '@/lib/rate-limit';
import { AuditLog, JoinLink, User, Workspace } from '@/lib/models';
import { createAuthDiagnosticContext, logAuthDiagnosticFailure, runAuthDiagnosticStage } from '@/lib/auth-diagnostics';

const publicRegistrationUnavailableMessage = 'Public registration is temporarily unavailable. Please try again later or contact support.';

type OwnerWorkspaceResult = { workspaceId: string; reason?: never } | { workspaceId: null; reason: string };

function logOwnerWorkspaceFailure(requestId: string, reason: string) {
  // reason is selected from fixed internal codes; never include config values or database records.
  console.warn({ requestId, stage: 'register_default_workspace_lookup', reason });
}

export async function POST(request: Request) {
  const diagnostics = createAuthDiagnosticContext('register_request');
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
    const name = String(body.name || '').trim();
    const username = String(body.username || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const confirmPassword = String(body.confirmPassword || '');
    const invitationToken = String(body.invitationToken || '').trim();

    if (!name || !username || !email || !password || !confirmPassword) {
      return NextResponse.json({ message: 'All fields are required.' }, { status: 400 });
    }
    if (name.length < 2 || name.length > 100) return NextResponse.json({ message: 'Full Name must be between 2 and 100 characters.' }, { status: 400 });

    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      return NextResponse.json({ message: 'Username must be 3-30 characters and use letters, numbers, dots, underscores, or hyphens.' }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ message: 'Enter a valid email address.' }, { status: 400 });
    }

    if (password.length < 12) {
      return NextResponse.json({ message: 'Password must be at least 12 characters.' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ message: 'Passwords do not match.' }, { status: 400 });
    }

    const clientIdentity = requestIdentity(request);
    if (!clientIdentity) {
      return missingClientIdentityResponse('register_rate_limit_ip', 'Registration is temporarily unavailable. Please try again later.', diagnostics.requestId);
    }
    const rateLimit = await enforceRateLimit('registration-ip', clientIdentity, 6, 60 * 60 * 1000, {
      context: diagnostics,
      connectStage: 'register_rate_limit_ip_connect',
      bucketStage: 'register_rate_limit_ip_bucket',
      retryStage: 'register_rate_limit_ip_retry',
      decisionStage: 'register_rate_limit_ip',
      decisionReason: 'registration_ip_limit_exceeded',
    });
    if (rateLimit) return rateLimit;

    await runAuthDiagnosticStage(diagnostics, 'register_database_connect', () => connectDB(diagnostics));

    let joinLink: { _id: unknown; adminId: string; workspaceId: string; tokenHash: string } | null = null;
    let workspaceId: string | null = null;
    if (invitationToken) {
      if (!/^[A-Za-z0-9_-]{40,60}$/.test(invitationToken)) {
        return NextResponse.json({ message: 'This joining link is invalid, expired, or revoked.' }, { status: 400 });
      }
      joinLink = await runAuthDiagnosticStage(diagnostics, 'register_invitation_lookup', () => JoinLink.findOne({
        tokenHash: hashInvitationToken(invitationToken),
        status: 'active',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      }).lean());
      if (!joinLink) return NextResponse.json({ message: 'This joining link is invalid, expired, or revoked.' }, { status: 400 });

      const [admin, workspace] = await runAuthDiagnosticStage(diagnostics, 'register_invitation_access_check', () => Promise.all([
        User.exists({ _id: joinLink!.adminId, role: 'admin', status: 'active', workspaceId: joinLink!.workspaceId }),
        Workspace.exists({ _id: joinLink!.workspaceId, adminId: joinLink!.adminId, isActive: true }),
      ]));
      if (!admin || !workspace) return NextResponse.json({ message: 'This joining link is no longer available.' }, { status: 400 });
      workspaceId = joinLink.workspaceId;
    } else {
      const owner = await runAuthDiagnosticStage<OwnerWorkspaceResult>(diagnostics, 'register_default_workspace_lookup', async () => {
        // Bootstrap uses this configured identity to create the single owner account.
        // Never choose an arbitrary Super Admin/workspace if deployment configuration is missing.
        const ownerUsername = process.env.SUPER_ADMIN_USERNAME?.trim().toLowerCase();
        if (!ownerUsername) return { workspaceId: null, reason: 'owner_username_not_configured' };

        const owner = await User.findOne({ username: ownerUsername }).select('_id role status workspaceId').lean();
        if (!owner) return { workspaceId: null, reason: 'configured_owner_not_found' };
        if (owner.role !== 'super-admin') return { workspaceId: null, reason: 'configured_owner_role_mismatch' };
        if (owner.status !== 'active') return { workspaceId: null, reason: 'configured_owner_inactive' };
        if (!owner.workspaceId) return { workspaceId: null, reason: 'configured_owner_workspace_reference_missing' };

        const workspace = await Workspace.findById(owner.workspaceId).select('adminId isActive').lean();
        if (!workspace) return { workspaceId: null, reason: 'configured_owner_workspace_not_found' };
        if (String(workspace.adminId) !== String(owner._id)) return { workspaceId: null, reason: 'configured_owner_workspace_link_mismatch' };
        if (!workspace.isActive) return { workspaceId: null, reason: 'configured_owner_workspace_inactive' };
        return { workspaceId: String(owner.workspaceId) };
      });
      if (!owner.workspaceId) {
        logOwnerWorkspaceFailure(diagnostics.requestId, owner.reason || 'owner_workspace_resolution_failed');
        return NextResponse.json({ message: publicRegistrationUnavailableMessage, requestId: diagnostics.requestId }, { status: 400 });
      }
      workspaceId = owner.workspaceId;
    }
    if (!workspaceId) return NextResponse.json({ message: 'No active registration workspace is available.' }, { status: 400 });

    const existingUser = await runAuthDiagnosticStage(diagnostics, 'register_existing_user_lookup', () =>
      User.findOne({ $or: [{ username }, { email }] }));
    if (existingUser) {
      return NextResponse.json({ message: 'Unable to complete registration with those details.' }, { status: 400 });
    }

    const passwordHash = await runAuthDiagnosticStage(diagnostics, 'register_password_hash', () => bcrypt.hash(password, 12));
    const onboarding = createWorkerOnboardingToken();
    const databaseSession = await runAuthDiagnosticStage(diagnostics, 'register_transaction_start', () => User.startSession());
    try {
      await runAuthDiagnosticStage(diagnostics, 'register_invitation_audit_write', () => databaseSession.withTransaction(async () => {
        const [user] = await runAuthDiagnosticStage(diagnostics, 'register_user_create', () => User.create([{
          name,
          username,
          email,
          passwordHash,
          role: 'worker',
          status: 'pending',
          approvalRequired: true,
          workspaceId,
          onboardingTokenHash: onboarding.tokenHash,
          onboardingTokenExpiresAt: onboarding.expiresAt,
        }], { session: databaseSession }));

        const usedJoinLinkId = joinLink ? String(joinLink._id) : null;
        if (joinLink && usedJoinLinkId) {
          const updatedJoinLink = await JoinLink.updateOne(
            { _id: usedJoinLinkId, tokenHash: joinLink.tokenHash, status: 'active', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
            { $set: { lastUsedAt: new Date() } },
            { session: databaseSession },
          );
          if (updatedJoinLink.matchedCount !== 1) throw new Error('Invitation became unavailable during registration.');
        }

        await AuditLog.create([{
          workspaceId,
          actorId: String(user._id),
          actorRole: 'worker',
          action: joinLink ? 'worker.registered_by_invitation' : 'worker.registered_publicly',
          resourceType: 'user',
          resourceId: String(user._id),
          details: joinLink ? { joinLinkId: usedJoinLinkId } : { source: 'default-workspace' },
        }], { session: databaseSession });
      }));
    } finally {
      await databaseSession.endSession();
    }

    const response = NextResponse.json({
      success: true,
      pendingApproval: true,
      redirectTo: '/interview',
      message: 'Registration Successful! Complete your interview while your account awaits Admin approval.',
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(WORKER_ONBOARDING_COOKIE, onboarding.token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      expires: onboarding.expiresAt, path: '/',
    });
    return response;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      return NextResponse.json({ message: 'An account with that username or email already exists.' }, { status: 400 });
    }
    logAuthDiagnosticFailure(diagnostics, error);
    return NextResponse.json({ message: 'Unable to create your account right now.' }, { status: 500 });
  }
}
