import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, User } from '@/lib/models';

const profileFields = ['name', 'phone', 'whatsapp', 'facebook', 'telegram'] as const;
const paymentProviders = ['bKash', 'Nagad', 'Rocket', 'Bank Transfer'] as const;

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });
  if (session.role !== 'worker') return NextResponse.json({ message: 'This profile endpoint is for workers.' }, { status: 403 });

  await connectDB();
  const user = await User.findById(session.id).select('name username email phone whatsapp facebook telegram paymentAccounts').lean();
  if (!user) return NextResponse.json({ message: 'Account not found.' }, { status: 404 });
  return NextResponse.json({
    profile: {
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone || '',
      whatsapp: user.whatsapp || '',
      facebook: user.facebook || '',
      telegram: user.telegram || '',
      paymentAccounts: user.paymentAccounts || {},
    },
  });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'worker') return NextResponse.json({ message: 'Only workers can edit this profile.' }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }

  const updates: Record<string, unknown> = {};
  for (const field of profileFields) {
    if (typeof body[field] === 'string') {
      const value = body[field].trim();
      if (value.length > (field === 'name' ? 100 : 200)) return NextResponse.json({ message: `${field} is too long.` }, { status: 400 });
      updates[field] = value;
    }
  }
  if (body.paymentAccounts !== undefined) {
    if (!body.paymentAccounts || typeof body.paymentAccounts !== 'object' || Array.isArray(body.paymentAccounts)) return NextResponse.json({ message: 'Payment accounts must be an object.' }, { status: 400 });
    const paymentAccounts: Record<string, string> = {};
    for (const provider of paymentProviders) {
      const value = (body.paymentAccounts as Record<string, unknown>)[provider];
      if (value !== undefined) {
        if (typeof value !== 'string' || value.trim().length > 100) return NextResponse.json({ message: `Enter a valid ${provider} account value.` }, { status: 400 });
        paymentAccounts[provider] = value.trim();
      }
    }
    updates.paymentAccounts = paymentAccounts;
  }
  if (!Object.keys(updates).length) return NextResponse.json({ message: 'No editable profile fields were supplied.' }, { status: 400 });

  await connectDB();
  const previous = await User.findOne({ _id: session.id, role: 'worker', workspaceId: session.workspaceId }).select('name phone whatsapp facebook telegram paymentAccounts').lean();
  if (!previous) return NextResponse.json({ message: 'Worker profile not found.' }, { status: 404 });
  const user = await User.findOneAndUpdate({ _id: session.id, role: 'worker', workspaceId: session.workspaceId }, { $set: updates }, { returnDocument: 'after' }).select('name username email phone whatsapp facebook telegram paymentAccounts').lean();
  await AuditLog.create({
    workspaceId: session.workspaceId || null,
    actorId: session.id,
    actorRole: session.role,
    action: 'worker.profile_updated',
    resourceType: 'user',
    resourceId: session.id,
    details: { fields: Object.keys(updates) },
  });
  return NextResponse.json({ success: true, profile: user });
}
