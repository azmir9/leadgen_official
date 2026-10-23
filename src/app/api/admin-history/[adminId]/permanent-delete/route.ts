import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { User } from '@/lib/models';

type Context = { params: Promise<{ adminId: string }> };

const retentionBlocker = 'Permanent deletion is disabled because workspace ownership and retained audit, report, assignment, order, rate, payment, and invitation records reference this Admin by ID. Removing the account without a reviewed anonymization and retention plan could break historical attribution. The soft-deleted account and its history remain unchanged.';

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') return NextResponse.json({ message: 'Only the Super Admin can request permanent deletion.' }, { status: 403 });

  const { adminId } = await context.params;
  if (!/^[a-f\d]{24}$/i.test(adminId)) return NextResponse.json({ message: 'Invalid Admin account.' }, { status: 400 });
  let body: { confirmation?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  if (body.confirmation !== 'PERMANENTLY DELETE') return NextResponse.json({ message: 'Type PERMANENTLY DELETE to request the irreversible action.' }, { status: 400 });

  await connectDB();
  const deletedAdmin = await User.findOne({ _id: adminId, role: 'admin', status: 'deleted', deletedAt: { $ne: null } }).select('_id').lean();
  if (!deletedAdmin) return NextResponse.json({ message: 'Deleted Admin account not found.' }, { status: 404 });

  return NextResponse.json({ message: retentionBlocker, permanentDeletionAvailable: false }, { status: 409 });
}
