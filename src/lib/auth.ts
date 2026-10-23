import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { AuthSession, User } from '@/lib/models';
import { runAuthDiagnosticStage, type AuthDiagnosticContext } from '@/lib/auth-diagnostics';

export type AppRole = 'super-admin' | 'admin' | 'worker';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: AppRole;
  workspaceId?: string | null;
  status?: string;
  sessionVersion?: number;
}

function getJwtSecret() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured in production.');
  }

  return process.env.JWT_SECRET || 'leadgen-official-dev-secret';
}

export function signUserToken(user: SessionUser) {
  return jwt.sign(
    {
      sub: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      workspaceId: user.workspaceId ?? null,
      status: user.status ?? 'active',
      sessionVersion: user.sessionVersion ?? 0,
    },
    getJwtSecret(),
    { expiresIn: '7d' },
  );
}

export function verifyUserToken(token: string): SessionUser | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as {
      id?: string;
      sub?: string;
      name?: string;
      email?: string;
      username?: string;
      role?: AppRole;
      workspaceId?: string | null;
      status?: string;
      sessionVersion?: number;
    };

    if (!payload.id && !payload.sub) return null;
    if (!payload.role || !payload.email || !payload.username) return null;

    return {
      id: payload.id || payload.sub || '',
      name: payload.name || payload.username,
      email: payload.email,
      username: payload.username,
      role: payload.role,
      workspaceId: payload.workspaceId || null,
      status: payload.status || 'active',
      sessionVersion: payload.sessionVersion ?? 0,
    };
  } catch {
    return null;
  }
}

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createServerSession(user: SessionUser, rememberMe: boolean, diagnostics?: AuthDiagnosticContext) {
  if (diagnostics) {
    await runAuthDiagnosticStage(diagnostics, 'login_session_database_connect', () => connectDB(diagnostics));
  } else {
    await connectDB();
  }
  const token = randomBytes(32).toString('base64url');
  const lifetimeMs = (rememberMe ? 30 : 1) * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + lifetimeMs);
  const createSession = () => AuthSession.create({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      sessionVersion: user.sessionVersion ?? 0,
      expiresAt,
      rememberMe,
    });
  if (diagnostics) {
    await runAuthDiagnosticStage(diagnostics, 'login_session_insert', createSession);
  } else {
    await createSession();
  }
  return { token, expiresAt, maxAge: rememberMe ? Math.floor(lifetimeMs / 1000) : undefined };
}

export async function revokeServerSession(token: string) {
  await connectDB();
  const tokenHash = hashSessionToken(token);
  const revokedAt = new Date();
  const result = await AuthSession.updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt } });
  if (result.modifiedCount > 0) {
    const serverSession = await AuthSession.findOne({ tokenHash }).select('userId').lean();
    if (serverSession?.userId) await User.updateOne({ _id: serverSession.userId, role: 'admin' }, { $set: { lastLoggedOutAt: revokedAt } });
    return;
  }

  // Preserve legacy JWT compatibility while recording its logout revocation.
  const legacyUser = verifyUserToken(token);
  const payload = jwt.decode(token) as { exp?: number } | null;
  if (!legacyUser || !payload?.exp || payload.exp * 1000 <= Date.now()) return;
  try {
    await AuthSession.create({
      userId: legacyUser.id,
      tokenHash,
      sessionVersion: legacyUser.sessionVersion ?? 0,
      expiresAt: new Date(payload.exp * 1000),
      revokedAt,
      rememberMe: false,
    });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
    await AuthSession.updateOne({ tokenHash }, { $set: { revokedAt } });
  }
  if (legacyUser.role === 'admin') await User.updateOne({ _id: legacyUser.id, role: 'admin' }, { $set: { lastLoggedOutAt: revokedAt } });
}

export async function revokeUserSessions(userId: string) {
  await connectDB();
  await AuthSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

async function resolveCurrentSession(token: string) {
  const tokenHash = hashSessionToken(token);
  await connectDB();
  const serverSession = await AuthSession.findOne({ tokenHash }).lean();
  if (serverSession) {
    if (serverSession.revokedAt || serverSession.expiresAt <= new Date()) return null;
    const user = await User.findById(serverSession.userId).select('name email username role workspaceId status sessionVersion deletedAt').lean();
    if (!user || user.status !== 'active' || user.deletedAt || (user.sessionVersion ?? 0) !== serverSession.sessionVersion) return null;
    await recordAdminActivity(user);
    return {
      id: String(user._id), name: user.name, email: user.email, username: user.username,
      role: user.role, workspaceId: user.workspaceId || null, status: user.status,
      sessionVersion: user.sessionVersion ?? 0,
    } satisfies SessionUser;
  }

  const legacyUser = verifyUserToken(token);
  if (!legacyUser) return null;
  const user = await User.findById(legacyUser.id).select('name email username role workspaceId status sessionVersion deletedAt').lean();
  if (!user || user.status !== 'active' || user.deletedAt || (user.sessionVersion ?? 0) !== (legacyUser.sessionVersion ?? 0)) return null;
  await recordAdminActivity(user);
  return {
    id: String(user._id), name: user.name, email: user.email, username: user.username,
    role: user.role, workspaceId: user.workspaceId || null, status: user.status,
    sessionVersion: user.sessionVersion ?? 0,
  } satisfies SessionUser;
}

async function recordAdminActivity(user: { _id: unknown; role: string; status: string }) {
  if (user.role !== 'admin' || user.status !== 'active') return;
  const cutoff = new Date(Date.now() - 60_000);
  try {
    await User.updateOne(
      { _id: user._id, role: 'admin', status: 'active', $or: [{ lastActiveAt: null }, { lastActiveAt: { $lte: cutoff } }] },
      { $set: { lastActiveAt: new Date() } },
    );
  } catch { /* Activity recording must not interrupt an otherwise valid authenticated request. */ }
}

export async function getSessionFromCookies() {
  const cookieStore = await cookies();
  const token = cookieStore.get('leadgen_session')?.value;

  if (!token) return null;
  try {
    return await resolveCurrentSession(token);
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(req: NextRequest) {
  const token = req.cookies.get('leadgen_session')?.value;
  if (!token) return null;
  try {
    return await resolveCurrentSession(token);
  } catch {
    return null;
  }
}
