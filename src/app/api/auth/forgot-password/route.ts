import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { connectDB } from '@/lib/db';
import { enforceRateLimit, missingClientIdentityResponse, requestIdentity } from '@/lib/rate-limit';
import { AuditLog, PasswordReset, User } from '@/lib/models';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function POST(request: Request) {
  let body: { email?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ message: 'Enter a valid email address.' }, { status: 400 });

  const clientIdentity = requestIdentity(request);
  if (!clientIdentity) return missingClientIdentityResponse('password_reset_request_ip', 'Password reset is temporarily unavailable. Please try again.');
  const ipLimit = await enforceRateLimit('password-reset-ip', clientIdentity, 8, 60 * 60 * 1000);
  if (ipLimit) return ipLimit;
  const emailLimit = await enforceRateLimit('password-reset-email', email, 3, 60 * 60 * 1000);
  if (emailLimit) return emailLimit;

  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return NextResponse.json({ message: 'Password reset email is not configured. Contact support.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  await connectDB();
  const user = await User.findOne({ email, status: 'active' }).select('_id email').lean();
  if (!user) return NextResponse.json({ message: 'If an active account matches that email, a reset link will be sent.' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await PasswordReset.updateMany({ userId: String(user._id), usedAt: null }, { $set: { usedAt: new Date() } });
  await PasswordReset.create({ userId: String(user._id), tokenHash: hashToken(token), expiresAt, usedAt: null });
  await AuditLog.create({ workspaceId: null, actorId: String(user._id), actorRole: 'worker', action: 'account.password_reset_requested', resourceType: 'user', resourceId: String(user._id) });

  const baseUrl = process.env.APP_URL || new URL(request.url).origin;
  const resetUrl = new URL('/reset-password', baseUrl);
  resetUrl.searchParams.set('token', token);
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: [user.email],
      subject: 'Reset your Leadgen Official password',
      html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>This link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.</p>`,
    });
    if (result.error) throw new Error('Email delivery failed.');
  } catch {
    await PasswordReset.updateOne({ tokenHash: hashToken(token), usedAt: null }, { $set: { usedAt: new Date() } });
  }

  return NextResponse.json({ message: 'If an active account matches that email, a reset link will be sent.' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
