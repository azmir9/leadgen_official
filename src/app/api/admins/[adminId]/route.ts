import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, AuthSession, JoinLink, User } from '@/lib/models';

type Context = { params: Promise<{ adminId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') return NextResponse.json({ message: 'Only the Super Admin can manage Admin accounts.' }, { status: 403 });

  const { adminId } = await context.params;
  if (!/^[a-f\d]{24}$/i.test(adminId)) return NextResponse.json({ message: 'Invalid Admin account.' }, { status: 400 });
  let body: { status?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const status = String(body.status || '');
  if (!['active', 'inactive', 'blocked'].includes(status)) return NextResponse.json({ message: 'Status must be active, inactive, or blocked.' }, { status: 400 });

  await connectDB();
  const databaseSession = await User.startSession();
  let outcome: 'updated' | 'not_found' | 'already_set' | 'conflict' = 'not_found';
  let revokedLinks = 0;
  let revokedSessions = 0;
  try {
    await databaseSession.withTransaction(async () => {
      const previous = await User.findOne({ _id: adminId, role: 'admin', deletedAt: null }).select('status workspaceId').session(databaseSession).lean();
      if (!previous) { outcome = 'not_found'; return; }
      if (previous.status === status) { outcome = 'already_set'; return; }
      const admin = await User.findOneAndUpdate(
        { _id: adminId, role: 'admin', status: previous.status, deletedAt: null },
        { $set: { status, ...(status === 'active' ? {} : { lastLoggedOutAt: new Date() }) }, $inc: { sessionVersion: 1 } },
        { returnDocument: 'after', session: databaseSession },
      ).select('_id workspaceId status').lean();
      if (!admin) { outcome = 'conflict'; return; }

      if (status !== 'active') {
        const links = await JoinLink.updateMany({ adminId, status: 'active' }, { $set: { status: 'revoked' } }, { session: databaseSession });
        const sessions = await AuthSession.updateMany({ userId: adminId, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session: databaseSession });
        revokedLinks = links.modifiedCount;
        revokedSessions = sessions.modifiedCount;
      }
      await AuditLog.create([{
        workspaceId: admin.workspaceId || null,
        actorId: session.id,
        actorRole: session.role,
        action: status === 'blocked' ? 'admin.blocked' : previous.status === 'blocked' && status === 'active' ? 'admin.unblocked' : `admin.status_${status}`,
        resourceType: 'user',
        resourceId: adminId,
        details: { previousStatus: previous.status, status, revokedLinks, revokedSessions },
      }], { session: databaseSession });
      outcome = 'updated';
    });
  } catch {
    return NextResponse.json({ message: 'Unable to update this Admin account. No changes were committed; please retry.' }, { status: 500 });
  } finally {
    await databaseSession.endSession();
  }
  if (outcome === 'not_found') return NextResponse.json({ message: 'Admin account not found.' }, { status: 404 });
  if (outcome === 'conflict') return NextResponse.json({ message: 'Admin status changed concurrently. Refresh and retry.' }, { status: 409 });
  if (outcome === 'already_set') return NextResponse.json({ message: 'This Admin account already has that status.' }, { status: 409 });
  return NextResponse.json({ success: true, status, revokedLinks, revokedSessions });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') return NextResponse.json({ message: 'Only the Super Admin can delete Admin accounts.' }, { status: 403 });

  const { adminId } = await context.params;
  if (!/^[a-f\d]{24}$/i.test(adminId)) return NextResponse.json({ message: 'Invalid Admin account.' }, { status: 400 });

  await connectDB();
  const databaseSession = await User.startSession();
  let outcome: 'deleted' | 'already_deleted' | 'not_found' | 'conflict' = 'not_found';
  let revokedLinks = 0;
  let revokedSessions = 0;

  try {
    await databaseSession.withTransaction(async () => {
      const admin = await User.findOne({ _id: adminId, role: 'admin' }).select('name workspaceId status deletedAt').session(databaseSession).lean();
      if (!admin) {
        outcome = 'not_found';
        return;
      }
      if (admin.status === 'deleted' || admin.deletedAt) {
        outcome = 'already_deleted';
        return;
      }

      const deactivated = await User.findOneAndUpdate(
        { _id: adminId, role: 'admin', status: admin.status, deletedAt: null },
        { $set: { status: 'deleted', deletedAt: new Date(), deletedBy: session.id, deletionPreviousStatus: admin.status, lastLoggedOutAt: new Date() }, $inc: { sessionVersion: 1 } },
        { returnDocument: 'after', session: databaseSession },
      ).select('_id workspaceId').lean();
      if (!deactivated) { outcome = 'conflict'; return; }

      const links = await JoinLink.updateMany({ adminId, status: 'active' }, { $set: { status: 'revoked' } }, { session: databaseSession });
      const sessions = await AuthSession.updateMany({ userId: adminId, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session: databaseSession });
      revokedLinks = links.modifiedCount;
      revokedSessions = sessions.modifiedCount;

      await AuditLog.create([{
        workspaceId: admin.workspaceId || null,
        actorId: session.id,
        actorRole: session.role,
        action: 'admin.soft_deleted',
        resourceType: 'user',
        resourceId: adminId,
        details: { previousStatus: admin.status, status: 'deleted', revokedLinks, revokedSessions, historyPreserved: true },
      }], { session: databaseSession });
      outcome = 'deleted';
    });
  } catch {
    return NextResponse.json({ message: 'Unable to deactivate this Admin account. No changes were committed; please retry.' }, { status: 500 });
  } finally {
    await databaseSession.endSession();
  }

  if (outcome === 'not_found') return NextResponse.json({ message: 'Admin account not found.' }, { status: 404 });
  if (outcome === 'already_deleted') return NextResponse.json({ message: 'This Admin account is already deleted.' }, { status: 409 });
  if (outcome === 'conflict') return NextResponse.json({ message: 'Admin account changed concurrently. Refresh and retry.' }, { status: 409 });
  return NextResponse.json({ success: true, adminId, status: 'deleted', revokedLinks, revokedSessions, historyPreserved: true });
}
