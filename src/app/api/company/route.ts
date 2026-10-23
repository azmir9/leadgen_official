import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, CompanySettings } from '@/lib/models';

export async function GET() {
  try {
    await connectDB();
    const settings = await CompanySettings.findOne().lean();

    return NextResponse.json({
      companyName: settings?.companyName || 'Leadgen Official',
      ownerName: settings?.ownerName || 'Leadgen Official Owner',
      description: settings?.description || 'Professional digital marketing and lead generation services.',
      telegramLink: settings?.telegramLink || 'https://t.me/leadgenofficial',
      whatsappLink: settings?.whatsappLink || 'https://wa.me/8801700000000',
      contactEmail: settings?.contactEmail || 'hello@leadgenofficial.com',
      contactPhone: settings?.contactPhone || '+8801700000000',
      websiteUrl: settings?.websiteUrl || 'https://leadgenofficial.com',
      facebookLink: settings?.facebookLink || 'https://facebook.com/leadgenofficial',
      logoUrl: settings?.logoUrl || '',
      announcement: settings?.announcement || 'Welcome to Leadgen Official.',
      theme: settings?.theme || 'default',
    });
  } catch {
    return NextResponse.json({ message: 'Company settings unavailable.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') {
    return NextResponse.json({ message: 'Only the Super Admin can update official company settings.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const fields = ['companyName', 'ownerName', 'logoUrl', 'description', 'contactEmail', 'contactPhone', 'telegramLink', 'whatsappLink', 'facebookLink', 'websiteUrl', 'announcement', 'theme'] as const;
  const updates: Partial<Record<(typeof fields)[number], string>> = {};
  for (const field of fields) {
    if (typeof body[field] === 'string') updates[field] = body[field].trim();
  }

  if (updates.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.contactEmail)) {
    return NextResponse.json({ message: 'Enter a valid official email address.' }, { status: 400 });
  }
  for (const field of ['logoUrl', 'telegramLink', 'whatsappLink', 'facebookLink', 'websiteUrl'] as const) {
    const value = updates[field];
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      return NextResponse.json({ message: `${field} must be a valid HTTP or HTTPS URL.` }, { status: 400 });
    }
  }
  if (!Object.keys(updates).length) return NextResponse.json({ message: 'No company setting fields were supplied.' }, { status: 400 });

  await connectDB();
  const before = await CompanySettings.findOne().lean();
  const settings = await CompanySettings.findOneAndUpdate({}, { $set: updates }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
  await AuditLog.create({
    workspaceId: session.workspaceId || null,
    actorId: session.id,
    actorRole: session.role,
    action: 'company_settings.updated',
    resourceType: 'company_settings',
    resourceId: String(settings?._id || ''),
    details: { changedFields: Object.keys(updates), previous: Object.fromEntries(Object.keys(updates).map((key) => [key, before?.[key as keyof typeof before] ?? null])), next: updates },
  });

  return NextResponse.json({ success: true });
}
