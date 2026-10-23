import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { encryptInvitationToken, createInvitationToken, hashInvitationToken, decryptInvitationToken } from '@/lib/invitations';
import { AuditLog, JoinLink, User, Workspace } from '@/lib/models';

type Context = { params: Promise<{ adminId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const session = await getSessionFromRequest(request);
  const { adminId } = await context.params;
  if (!session || (session.role !== 'super-admin' && (session.role !== 'admin' || session.id !== adminId))) {
    return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });
  }

  await connectDB();
  const link = await JoinLink.findOne({ adminId, status: 'active' }).sort({ createdAt: -1 }).lean();
  if (!link) return NextResponse.json({ link: null });

  return NextResponse.json({
    link: {
      url: `${new URL(request.url).origin}/register?invite=${encodeURIComponent(decryptInvitationToken(link.tokenCiphertext))}`,
      status: link.expiresAt && link.expiresAt <= new Date() ? 'expired' : 'active',
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      lastUsedAt: link.lastUsedAt,
    },
  });
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') {
    return NextResponse.json({ message: 'Only the Super Admin can create or rotate joining links.' }, { status: 403 });
  }

  const { adminId } = await context.params;
  let body: { expiresInDays?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const rawDays = body.expiresInDays;
  const expiresInDays = rawDays === undefined || rawDays === null || rawDays === '' ? null : Number(rawDays);
  if (expiresInDays !== null && (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)) {
    return NextResponse.json({ message: 'Expiration must be between 1 and 365 days, or omitted for no expiration.' }, { status: 400 });
  }

  await connectDB();
  const admin = await User.findOne({ _id: adminId, role: 'admin', status: 'active' }).select('_id workspaceId').lean();
  if (!admin || !admin.workspaceId || !(await Workspace.exists({ _id: admin.workspaceId, adminId, isActive: true }))) {
    return NextResponse.json({ message: 'Active Admin workspace not found.' }, { status: 404 });
  }

  const token = createInvitationToken();
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
  const previousLinks = await JoinLink.find({ adminId, status: 'active' }).select('_id').lean();
  await JoinLink.updateMany({ adminId, status: 'active' }, { $set: { status: 'revoked' } });
  const link = await JoinLink.create({
    adminId,
    workspaceId: String(admin.workspaceId),
    tokenHash: hashInvitationToken(token),
    tokenCiphertext: encryptInvitationToken(token),
    status: 'active',
    expiresAt,
  });
  await AuditLog.create({
    workspaceId: String(admin.workspaceId),
    actorId: session.id,
    actorRole: session.role,
    action: previousLinks.length ? 'joining_link.rotated' : 'joining_link.created',
    resourceType: 'joining_link',
    resourceId: String(link._id),
    details: { adminId, expiresAt },
  });

  return NextResponse.json({
    success: true,
    link: {
      url: `${new URL(request.url).origin}/register?invite=${encodeURIComponent(token)}`,
      status: link.status,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      lastUsedAt: link.lastUsedAt,
    },
  }, { status: 201 });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') {
    return NextResponse.json({ message: 'Only the Super Admin can revoke joining links.' }, { status: 403 });
  }

  const { adminId } = await context.params;
  await connectDB();
  const admin = await User.findOne({ _id: adminId, role: 'admin' }).select('workspaceId').lean();
  if (!admin) return NextResponse.json({ message: 'Admin not found.' }, { status: 404 });

  const result = await JoinLink.updateMany({ adminId, status: 'active' }, { $set: { status: 'revoked' } });
  await AuditLog.create({
    workspaceId: admin.workspaceId || null,
    actorId: session.id,
    actorRole: session.role,
    action: 'joining_link.revoked',
    resourceType: 'joining_link',
    details: { adminId, revokedCount: result.modifiedCount },
  });
  return NextResponse.json({ success: true, revoked: result.modifiedCount });
}
