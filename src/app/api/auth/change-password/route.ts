import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, revokeUserSessions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, User } from '@/lib/models';

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });

  let body: { currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (!currentPassword || newPassword.length < 12 || newPassword !== confirmPassword) {
    return NextResponse.json({ message: 'Enter your current password and matching new passwords of at least 12 characters.' }, { status: 400 });
  }
  if (currentPassword === newPassword) return NextResponse.json({ message: 'Choose a new password different from your current password.' }, { status: 400 });

  await connectDB();
  const user = await User.findOne({ _id: session.id, status: 'active' }).select('passwordHash sessionVersion workspaceId').lean();
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return NextResponse.json({ message: 'Current password is incorrect.' }, { status: 401 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const update = await User.updateOne({ _id: session.id, passwordHash: user.passwordHash }, { $set: { passwordHash }, $inc: { sessionVersion: 1 } });
  if (update.modifiedCount !== 1) return NextResponse.json({ message: 'Password changed elsewhere. Sign in again.' }, { status: 409 });
  await revokeUserSessions(session.id);
  await AuditLog.create({
    workspaceId: user.workspaceId || null,
    actorId: session.id,
    actorRole: session.role,
    action: 'account.password_changed',
    resourceType: 'user',
    resourceId: session.id,
  });

  const response = NextResponse.json({ success: true, message: 'Password changed. Sign in again on your devices.' });
  response.cookies.set('leadgen_session', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: new Date(0) });
  return response;
}
