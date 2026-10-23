import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, Workspace } from '@/lib/models';

type Announcement = { id: string; message: string; createdAt: string; updatedAt: string };

function announcementsFrom(workspace: { settings?: unknown }) {
  const settings = workspace.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const announcements = (settings as { announcements?: unknown }).announcements;
  if (!Array.isArray(announcements)) return [];
  return announcements.flatMap((announcement): Announcement[] => {
    if (!announcement || typeof announcement !== 'object') return [];
    const value = announcement as Partial<Announcement>;
    if (typeof value.id !== 'string' || typeof value.message !== 'string') return [];
    return [{
      id: value.id,
      message: value.message,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    }];
  });
}

function validMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const message = value.trim();
  return message.length > 0 && message.length <= 2000 ? message : null;
}

function workspaceFilter(session: { id: string; role: string; workspaceId?: string | null }) {
  if (!session.workspaceId) return null;
  if (session.role === 'admin') return { _id: session.workspaceId, adminId: session.id, isActive: true };
  if (session.role === 'worker') return { _id: session.workspaceId, isActive: true };
  return null;
}

async function writeAudit(session: { id: string; role: string }, workspaceId: string, action: string, id: string) {
  await AuditLog.create({
    workspaceId,
    actorId: session.id,
    actorRole: session.role,
    action,
    resourceType: 'workspace_announcement',
    resourceId: id,
    details: { announcementId: id },
  });
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'worker'].includes(session.role)) return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });
  const filter = workspaceFilter(session);
  if (!filter) return NextResponse.json({ message: 'Your account is not assigned to an active workspace.' }, { status: 409 });

  await connectDB();
  const workspace = await Workspace.findOne(filter).select('settings.announcements').lean();
  if (!workspace) return NextResponse.json({ message: 'Workspace not found.' }, { status: 404 });
  return NextResponse.json({ announcements: announcementsFrom(workspace) });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'admin') return NextResponse.json({ message: 'Only the workspace Admin can manage announcements.' }, { status: 403 });
  const filter = workspaceFilter(session);
  if (!filter || !session.workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 409 });

  let body: { message?: unknown; workspaceId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  if (body.workspaceId !== undefined && body.workspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  const message = validMessage(body.message);
  if (!message) return NextResponse.json({ message: 'Announcement must contain 1 to 2,000 characters.' }, { status: 400 });

  await connectDB();
  const now = new Date().toISOString();
  const announcement: Announcement = { id: randomUUID(), message, createdAt: now, updatedAt: now };
  const workspace = await Workspace.findOneAndUpdate(filter, { $push: { 'settings.announcements': announcement } }, { returnDocument: 'after' }).select('settings.announcements').lean();
  if (!workspace) return NextResponse.json({ message: 'Workspace not found.' }, { status: 404 });
  await writeAudit(session, session.workspaceId, 'workspace_announcement.created', announcement.id);
  return NextResponse.json({ success: true, announcement }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'admin') return NextResponse.json({ message: 'Only the workspace Admin can manage announcements.' }, { status: 403 });
  const filter = workspaceFilter(session);
  if (!filter || !session.workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 409 });

  let body: { id?: unknown; message?: unknown; workspaceId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  if (body.workspaceId !== undefined && body.workspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  const id = typeof body.id === 'string' ? body.id : '';
  const message = validMessage(body.message);
  if (!id || !message) return NextResponse.json({ message: 'Provide an announcement and valid message.' }, { status: 400 });

  await connectDB();
  const workspace = await Workspace.findOneAndUpdate(
    { ...filter, 'settings.announcements.id': id },
    { $set: { 'settings.announcements.$.message': message, 'settings.announcements.$.updatedAt': new Date().toISOString() } },
    { returnDocument: 'after' },
  ).select('settings.announcements').lean();
  if (!workspace) return NextResponse.json({ message: 'Announcement not found in this workspace.' }, { status: 404 });
  await writeAudit(session, session.workspaceId, 'workspace_announcement.updated', id);
  const announcement = announcementsFrom(workspace).find((item) => item.id === id);
  return NextResponse.json({ success: true, announcement });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'admin') return NextResponse.json({ message: 'Only the workspace Admin can manage announcements.' }, { status: 403 });
  const filter = workspaceFilter(session);
  if (!filter || !session.workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 409 });
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!id) return NextResponse.json({ message: 'Announcement ID is required.' }, { status: 400 });

  await connectDB();
  const workspace = await Workspace.findOneAndUpdate(
    { ...filter, 'settings.announcements.id': id },
    { $pull: { 'settings.announcements': { id } } },
    { returnDocument: 'after' },
  ).select('settings.announcements').lean();
  if (!workspace) return NextResponse.json({ message: 'Announcement not found in this workspace.' }, { status: 404 });
  await writeAudit(session, session.workspaceId, 'workspace_announcement.deleted', id);
  return NextResponse.json({ success: true });
}
