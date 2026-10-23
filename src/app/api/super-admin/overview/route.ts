import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { Assignment, OfficialReport, User, UserOrder, Workspace } from '@/lib/models';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') return NextResponse.json({ message: 'Only the Super Admin can view global metrics.' }, { status: 403 });

  await connectDB();
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit)) return NextResponse.json({ message: 'Invalid pagination.' }, { status: 400 });
  const [admins, workers, pendingWorkers, assignments, pendingOrders, reports, workspaces] = await Promise.all([
    User.countDocuments({ role: 'admin', deletedAt: null, status: { $ne: 'deleted' } }),
    User.countDocuments({ role: 'worker' }),
    User.countDocuments({ role: 'worker', status: 'pending' }),
    Assignment.countDocuments({ status: 'active' }),
    UserOrder.countDocuments({ pendingQuantity: { $gt: 0 } }),
    OfficialReport.countDocuments(),
    Workspace.find({ isActive: true }).select('_id name adminId').sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const workspaceTotal = await Workspace.countDocuments({ isActive: true });

  return NextResponse.json({
    stats: { admins, workers, pendingWorkers, assignments, pendingOrders, reports, workspaces: workspaceTotal },
    workspaces: workspaces.map((workspace) => ({ id: String(workspace._id), name: workspace.name, adminId: workspace.adminId })),
    workspacePage: page,
    workspaceLimit: limit,
    workspaceTotal,
    workspaceHasMore: page * limit < workspaceTotal,
  });
}
