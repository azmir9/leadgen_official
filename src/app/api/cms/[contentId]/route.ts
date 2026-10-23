import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, CmsContent } from '@/lib/models';

type Context = { params: Promise<{ contentId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') return NextResponse.json({ message: 'Only the Super Admin can archive public content.' }, { status: 403 });
  const { contentId } = await context.params;
  await connectDB();
  const before = await CmsContent.findById(contentId).lean();
  if (!before) return NextResponse.json({ message: 'Content item not found.' }, { status: 404 });
  if (before.status === 'archived') return NextResponse.json({ message: 'Content item is already archived.' }, { status: 409 });
  await CmsContent.updateOne({ _id: contentId, status: before.status }, { $set: { status: 'archived', archivedAt: new Date(), updatedBy: session.id } });
  await AuditLog.create({ workspaceId: null, actorId: session.id, actorRole: session.role, action: 'cms.content_archived', resourceType: 'cms_content', resourceId: contentId, details: { type: before.type, slug: before.slug, previousStatus: before.status } });
  return NextResponse.json({ success: true, status: 'archived' });
}
