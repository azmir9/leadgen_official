import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { enforceRateLimit, missingClientIdentityResponse, requestIdentity } from '@/lib/rate-limit';
import { AuditLog, AuthSession, PasswordReset, User } from '@/lib/models';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function POST(request: Request) {
  let body: { token?: unknown; password?: unknown; confirmPassword?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const token = String(body.token || '');
  const password = String(body.password || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || password.length < 12 || password !== confirmPassword) {
    return NextResponse.json({ message: 'Reset link is invalid or expired, or the new passwords do not match the minimum requirements.' }, { status: 400 });
  }

  const clientIdentity = requestIdentity(request);
  if (!clientIdentity) return missingClientIdentityResponse('password_reset_completion_ip', 'Password reset is temporarily unavailable. Please try again.');
  const ipLimit = await enforceRateLimit('password-reset-completion-ip', clientIdentity, 12, 60 * 60 * 1000);
  if (ipLimit) return ipLimit;
  const tokenLimit = await enforceRateLimit('password-reset-completion-token', token, 5, 60 * 60 * 1000);
  if (tokenLimit) return tokenLimit;

  await connectDB();
  const passwordHash = await bcrypt.hash(password, 12);
  const databaseSession = await mongoose.startSession();
  let userId = '';
  let invalidToken = false;
  try {
    await databaseSession.withTransaction(async () => {
      const reset = await PasswordReset.findOneAndUpdate(
        { tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { returnDocument: 'after', session: databaseSession },
      ).lean();
      if (!reset) throw new Error('INVALID_RESET_TOKEN');
      const user = await User.findOneAndUpdate(
        { _id: reset.userId, status: 'active' },
        { $set: { passwordHash }, $inc: { sessionVersion: 1 } },
        { returnDocument: 'after', session: databaseSession },
      ).select('role workspaceId').lean();
      if (!user) throw new Error('INVALID_RESET_USER');
      userId = reset.userId;
      await AuthSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session: databaseSession });
      await AuditLog.create([{
        workspaceId: user.workspaceId || null,
        actorId: userId,
        actorRole: user.role,
        action: 'account.password_reset_completed',
        resourceType: 'user',
        resourceId: userId,
      }], { session: databaseSession });
    });
  } catch (error) {
    if (error instanceof Error && ['INVALID_RESET_TOKEN', 'INVALID_RESET_USER'].includes(error.message)) invalidToken = true;
    else return NextResponse.json({ message: 'Unable to reset password. Please try again.' }, { status: 500 });
  } finally {
    await databaseSession.endSession();
  }

  if (invalidToken) return NextResponse.json({ message: 'Reset link is invalid or expired.' }, { status: 400 });
  const response = NextResponse.json({ success: true, message: 'Password updated. Sign in with your new password.' });
  response.cookies.set('leadgen_session', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: new Date(0) });
  return response;
}
