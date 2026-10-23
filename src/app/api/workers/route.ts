import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, User } from '@/lib/models';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) {
    return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const requestedWorkspaceId = url.searchParams.get('workspaceId');
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) {
    return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  }
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (!workspaceId) return NextResponse.json({ message: 'Select a workspace.' }, { status: 400 });

  await connectDB();
  const filter: Record<string, unknown> = { role: 'worker', workspaceId };
  const status = url.searchParams.get('status');
  if (status) {
    if (!['pending', 'active', 'inactive', 'blocked'].includes(status)) return NextResponse.json({ message: 'Invalid worker status.' }, { status: 400 });
    filter.status = status;
  }
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) return NextResponse.json({ message: 'Dates must use YYYY-MM-DD.' }, { status: 400 });
  if (from || to) filter.createdAt = { ...(from ? { $gte: new Date(`${from}T00:00:00+06:00`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999+06:00`) } : {}) };
  const search = url.searchParams.get('q')?.trim();
  if (search) {
    const escaped = search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { username: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } }];
  }
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit)) return NextResponse.json({ message: 'Invalid pagination.' }, { status: 400 });
  const [workers, total] = await Promise.all([User.find(filter)
    .select('name username email status phone whatsapp createdAt')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean(), User.countDocuments(filter)]);

  return NextResponse.json({ workers: workers.map((worker) => ({
    id: String(worker._id),
    name: worker.name,
    username: worker.username,
    email: worker.email,
    status: worker.status,
    phone: worker.phone || '',
    whatsapp: worker.whatsapp || '',
    createdAt: worker.createdAt,
  })), page, limit, total, hasMore: page * limit < total });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) {
    return NextResponse.json({ message: 'Not authorized.' }, { status: 403 });
  }

  let body: { workerId?: unknown; status?: unknown; workspaceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const workerId = String(body.workerId || '');
  const status = String(body.status || '');
  const requestedWorkspaceId = String(body.workspaceId || '');
  if (!workerId || !['active', 'inactive', 'blocked'].includes(status)) {
    return NextResponse.json({ message: 'Choose a valid worker and status.' }, { status: 400 });
  }
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) {
    return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  }
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (!workspaceId) return NextResponse.json({ message: 'Workspace is required.' }, { status: 400 });

  await connectDB();
  const currentWorker = await User.findOne({ _id: workerId, role: 'worker', workspaceId }).select('status approvalRequired').lean();
  if (!currentWorker) return NextResponse.json({ message: 'Worker not found in this workspace.' }, { status: 404 });
  if (currentWorker.status === 'pending' && status !== 'active') return NextResponse.json({ message: 'Pending Workers remain pending until their interview is reviewed.' }, { status: 409 });
  if (status === 'active' && (currentWorker.status === 'pending' || currentWorker.approvalRequired)) return NextResponse.json({ message: 'Review and approve the submitted interview to activate this Worker.' }, { status: 409 });
  const worker = await User.findOneAndUpdate(
    { _id: workerId, role: 'worker', workspaceId },
    { $set: { status }, $inc: { sessionVersion: 1 } },
    { returnDocument: 'after' },
  ).select('name username status workspaceId').lean();

  if (!worker) return NextResponse.json({ message: 'Worker not found in this workspace.' }, { status: 404 });
  await AuditLog.create({
    workspaceId,
    actorId: session.id,
    actorRole: session.role,
    action: `worker.status_${status}`,
    resourceType: 'user',
    resourceId: String(worker._id),
    details: { workerId: String(worker._id), status },
  });

  return NextResponse.json({ success: true, worker: { id: String(worker._id), name: worker.name, username: worker.username, status: worker.status } });
}
