import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { User, Workspace } from '@/lib/models';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') return NextResponse.json({ message: 'Only the Super Admin can view Admin History.' }, { status: 403 });

  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') || 1);
  const limit = Number(url.searchParams.get('limit') || 25);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ message: 'Invalid pagination.' }, { status: 400 });
  }

  await connectDB();
  const filter = { role: 'admin', $or: [{ deletedAt: { $ne: null } }, { status: 'deleted' }] };
  const [deletedAdmins, total] = await Promise.all([
    User.find(filter).select('_id name username workspaceId deletedAt deletedBy deletionPreviousStatus createdAt').sort({ deletedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  const adminIds = deletedAdmins.map((admin) => String(admin._id));
  const actorIds = [...new Set(deletedAdmins.map((admin) => admin.deletedBy).filter((id): id is string => Boolean(id)))];
  const [workspaces, actors] = await Promise.all([
    Workspace.find({ adminId: { $in: adminIds } }).select('adminId name').lean(),
    actorIds.length ? User.find({ _id: { $in: actorIds } }).select('name username role').lean() : Promise.resolve([]),
  ]);

  return NextResponse.json({
    entries: deletedAdmins.map((admin) => {
      const workspace = workspaces.find((item) => item.adminId === String(admin._id));
      const actor = actors.find((item) => String(item._id) === admin.deletedBy);
      return {
        id: String(admin._id), name: admin.name, username: admin.username,
        workspace: workspace ? { id: String(workspace._id), name: workspace.name } : null,
        deletedAt: admin.deletedAt || admin.updatedAt || null,
        deletedBy: actor ? { id: String(actor._id), name: actor.name, username: actor.username, role: actor.role } : { id: admin.deletedBy || null, name: 'Former account unavailable' },
        previousStatus: admin.deletionPreviousStatus || 'unknown',
      };
    }),
    page, limit, total, hasMore: page * limit < total,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
