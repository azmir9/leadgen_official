import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, Workspace } from '@/lib/models';

function ownWorkspaceFilter(session: { id: string; role: string; workspaceId?: string | null }) {
  if (session.role !== 'admin' || !session.workspaceId) return null;
  return { _id: session.workspaceId, adminId: session.id };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'admin') return NextResponse.json({ message: 'Only an Admin can view workspace settings.' }, { status: 403 });
  const filter = ownWorkspaceFilter(session);
  if (!filter) return NextResponse.json({ message: 'Workspace is required.' }, { status: 409 });

  await connectDB();
  const workspace = await Workspace.findOne(filter).select('_id name').lean();
  if (!workspace) return NextResponse.json({ message: 'Workspace not found.' }, { status: 404 });
  return NextResponse.json({ name: workspace.name });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'admin') return NextResponse.json({ message: 'Only an Admin can update workspace settings.' }, { status: 403 });
  const filter = ownWorkspaceFilter(session);
  if (!filter || !session.workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 409 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  if (Object.keys(body).some((key) => key !== 'name')) return NextResponse.json({ message: 'Only the workspace name can be changed here.' }, { status: 400 });
  if (typeof body.name !== 'string' || !body.name.trim()) return NextResponse.json({ message: 'Workspace name is required.' }, { status: 400 });
  const name = body.name.trim();

  await connectDB();
  const before = await Workspace.findOne(filter).select('name').lean();
  if (!before) return NextResponse.json({ message: 'Workspace not found.' }, { status: 404 });
  if (before.name === name) return NextResponse.json({ success: true, name });

  const workspace = await Workspace.findOneAndUpdate(
    filter,
    { $set: { name } },
    { returnDocument: 'after', runValidators: true },
  ).select('_id name').lean();
  if (!workspace) return NextResponse.json({ message: 'Workspace not found.' }, { status: 404 });
  await AuditLog.create({
    workspaceId: session.workspaceId,
    actorId: session.id,
    actorRole: session.role,
    action: 'workspace.name_updated',
    resourceType: 'workspace',
    resourceId: String(workspace._id),
    details: { before: before.name, after: workspace.name },
  });
  return NextResponse.json({ success: true, name: workspace.name });
}
