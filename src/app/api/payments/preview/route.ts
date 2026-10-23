import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { buildClearancePreview } from '@/lib/payments';

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !['admin', 'super-admin'].includes(session.role)) return NextResponse.json({ message: 'Only an Admin can preview payment clearance.' }, { status: 403 });
  let body: { workerId?: unknown; reportDates?: unknown; workspaceId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const workerId = String(body.workerId || '');
  const requestedWorkspaceId = body.workspaceId ? String(body.workspaceId) : null;
  if (session.role === 'admin' && requestedWorkspaceId && requestedWorkspaceId !== session.workspaceId) return NextResponse.json({ message: 'Not authorized for this workspace.' }, { status: 403 });
  const workspaceId = session.role === 'admin' ? session.workspaceId : requestedWorkspaceId;
  if (!workspaceId || !workerId || !Array.isArray(body.reportDates) || body.reportDates.some((date) => typeof date !== 'string')) return NextResponse.json({ message: 'Workspace, worker, and report dates are required.' }, { status: 400 });

  await connectDB();
  const preview = await buildClearancePreview(workspaceId, workerId, body.reportDates as string[]);
  if ('error' in preview) return NextResponse.json(preview, { status: 409 });
  return NextResponse.json(preview);
}
