import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { decryptInvitationToken } from '@/lib/invitations';
import { AuditLog, AuthSession, JoinLink, User, Workspace } from '@/lib/models';
import { deriveAdminStatus, getAdminInactivityWindowMs } from '@/lib/admin-status';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !['super-admin', 'admin'].includes(session.role)) {
    return NextResponse.json({ message: 'Not authorized.' }, { status: 401 });
  }

  await connectDB();
  if (session.role === 'admin') {
    const links = await JoinLink.find({ adminId: session.id, status: 'active' })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();
    return NextResponse.json({
      links: links.map((link) => ({
        url: `${new URL(request.url).origin}/register?invite=${encodeURIComponent(decryptInvitationToken(link.tokenCiphertext))}`,
        status: link.expiresAt && link.expiresAt <= new Date() ? 'expired' : link.status,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        lastUsedAt: link.lastUsedAt,
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const page = Math.max(1, Number(new URL(request.url).searchParams.get('page') || 1));
  const limit = Math.max(1, Math.min(100, Number(new URL(request.url).searchParams.get('limit') || 50)));
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit)) return NextResponse.json({ message: 'Invalid pagination.' }, { status: 400 });
  const adminFilter: Record<string, unknown> = { role: 'admin', deletedAt: null, status: { $ne: 'deleted' } };
  const status = new URL(request.url).searchParams.get('status');
  if (status) {
    if (!['active', 'inactive', 'blocked'].includes(status)) return NextResponse.json({ message: 'Invalid Admin status.' }, { status: 400 });
  }
  const from = new URL(request.url).searchParams.get('from');
  const to = new URL(request.url).searchParams.get('to');
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) return NextResponse.json({ message: 'Dates must use YYYY-MM-DD.' }, { status: 400 });
  if (from || to) adminFilter.createdAt = { ...(from ? { $gte: new Date(`${from}T00:00:00+06:00`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999+06:00`) } : {}) };
  const search = new URL(request.url).searchParams.get('q')?.trim();
  if (search) {
    const escaped = search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    adminFilter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { username: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } }];
  }
  const now = Date.now();
  const activeCandidates = await User.find({ role: 'admin', status: 'active', deletedAt: null })
    .select('_id sessionVersion lastActiveAt lastLoggedOutAt')
    .lean();
  const candidateIds = activeCandidates.map((admin) => String(admin._id));
  const activeSessions = candidateIds.length
    ? await AuthSession.find({ userId: { $in: candidateIds }, revokedAt: null, expiresAt: { $gt: new Date(now) } }).select('userId sessionVersion').lean()
    : [];
  const candidateVersions = new Map(activeCandidates.map((admin) => [String(admin._id), admin.sessionVersion ?? 0]));
  const activeSessionIds = new Set(activeSessions.filter((item) => (item.sessionVersion ?? 0) === candidateVersions.get(item.userId)).map((item) => item.userId));
  const inactivityWindowMs = getAdminInactivityWindowMs();
  const activeAdminIds = activeCandidates
    .filter((admin) => deriveAdminStatus(admin, activeSessionIds, now, inactivityWindowMs) === 'active')
    .map((admin) => String(admin._id));
  const filteredStatus: Record<string, unknown> | undefined = status === 'active'
    ? { _id: { $in: activeAdminIds } }
    : status === 'inactive'
      ? { $or: [{ status: 'inactive' }, { status: 'active', _id: { $nin: activeAdminIds } }] }
      : status === 'blocked' ? { status: 'blocked' } : undefined;
  const finalAdminFilter = filteredStatus ? { $and: [adminFilter, filteredStatus] } : adminFilter;
  const [admins, total] = await Promise.all([User.find(finalAdminFilter)
    .select('name username email status workspaceId createdAt')
    .select('sessionVersion lastActiveAt lastLoggedOutAt')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean(), User.countDocuments(finalAdminFilter)]);
  const adminIds = admins.map((admin) => String(admin._id));
  const [workspaces, links] = await Promise.all([
    Workspace.find({ adminId: { $in: adminIds } }).select('_id name adminId isActive').lean(),
    JoinLink.find({ adminId: { $in: adminIds }, status: 'active' }).select('adminId status expiresAt createdAt lastUsedAt').sort({ createdAt: -1 }).lean(),
  ]);

  return NextResponse.json({
    admins: admins.map((admin) => {
      const workspace = workspaces.find((item) => item.adminId === String(admin._id));
      const link = links.find((item) => item.adminId === String(admin._id));
      return {
        id: String(admin._id),
        name: admin.name,
        username: admin.username,
        email: admin.email,
        status: deriveAdminStatus(admin, activeSessionIds, now, inactivityWindowMs),
        accountEnabled: admin.status === 'active',
        createdAt: admin.createdAt,
        workspace: workspace ? { id: String(workspace._id), name: workspace.name, isActive: workspace.isActive } : null,
        joinLink: link ? { status: link.expiresAt && link.expiresAt <= new Date() ? 'expired' : link.status, createdAt: link.createdAt, expiresAt: link.expiresAt, lastUsedAt: link.lastUsedAt } : null,
      };
    }),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') {
    return NextResponse.json({ message: 'Only the Super Admin can create Admin accounts.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const workspaceName = String(body.workspaceName || `${name}'s Workspace`).trim();

  if (!name || !/^[a-z0-9._-]{3,30}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || !workspaceName) {
    return NextResponse.json({ message: 'Provide a name, valid username and email, workspace name, and password of at least 12 characters.' }, { status: 400 });
  }

  await connectDB();
  if (await User.exists({ $or: [{ username }, { email }] })) {
    return NextResponse.json({ message: 'Username or email is already registered.' }, { status: 409 });
  }

  let admin;
  try {
    admin = await User.create({
      name,
      username,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'admin',
      status: 'active',
      workspaceId: null,
    });
    const workspace = await Workspace.create({ name: workspaceName, adminId: String(admin._id) });
    admin.workspaceId = String(workspace._id);
    await admin.save();
    await AuditLog.create({
      workspaceId: String(workspace._id),
      actorId: session.id,
      actorRole: session.role,
      action: 'admin.created',
      resourceType: 'user',
      resourceId: String(admin._id),
      details: { workspaceId: String(workspace._id), workspaceName },
    });
  } catch {
    if (admin?._id) {
      await Workspace.deleteOne({ adminId: String(admin._id) });
      await User.deleteOne({ _id: admin._id });
    }
    return NextResponse.json({ message: 'Unable to create Admin and workspace.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, admin: { id: String(admin._id), name: admin.name, username: admin.username, email: admin.email, workspaceId: admin.workspaceId } }, { status: 201 });
}
