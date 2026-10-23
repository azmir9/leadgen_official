import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { AuditLog } from '@/lib/models';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) {
    return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get('workspaceId');
  if (session.role === 'admin' && !session.workspaceId) {
    return NextResponse.json({ message: 'Your account is not assigned to a workspace.' }, { status: 403 });
  }
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) {
    return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  }
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page') || 1)));
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  if (!Number.isInteger(page) || !Number.isInteger(limit)) return NextResponse.json({ message: 'Invalid pagination.' }, { status: 400 });

  await connectDB();
  const filter = session.role === 'admin'
    ? { workspaceId: session.workspaceId }
    : requestedWorkspaceId ? { workspaceId: requestedWorkspaceId } : {};
  const [entries, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return NextResponse.json({
    entries: entries.map((entry) => ({
      id: String(entry._id),
      workspaceId: entry.workspaceId,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      details: entry.details,
      createdAt: entry.createdAt,
    })),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
}
