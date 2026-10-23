import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { connectDB } from '@/lib/db';
import { AuditLog, CmsContent } from '@/lib/models';

const contentTypes = ['blog', 'service', 'free-service', 'offer', 'banner', 'page'] as const;

type ContentType = (typeof contentTypes)[number];

function validUrl(value: string) {
  if (!value) return true;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function validateContent(data: Record<string, unknown>) {
  const type = String(data.type || '') as ContentType;
  const title = String(data.title || '').trim();
  const slug = String(data.slug || '').trim().toLowerCase();
  const imageUrl = String(data.imageUrl || '').trim();
  const status = String(data.status || 'draft');
  const publishAt = data.publishAt ? new Date(String(data.publishAt)) : null;
  if (!contentTypes.includes(type) || !title || title.length > 180 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 180) return { error: 'Provide a supported content type, title, and URL-safe slug.' as const };
  if (!['draft', 'published', 'archived'].includes(status)) return { error: 'Status must be draft, published, or archived.' as const };
  if (!validUrl(imageUrl)) return { error: 'Image URL must use HTTP or HTTPS.' as const };
  if (publishAt && Number.isNaN(publishAt.getTime())) return { error: 'Publish date is invalid.' as const };
  if (String(data.summary || '').length > 500 || String(data.content || '').length > 100_000 || String(data.imageAlt || '').length > 300 || String(data.seoTitle || '').length > 180 || String(data.seoDescription || '').length > 500) return { error: 'One or more content fields exceed their allowed length.' as const };
  return {
    value: {
      type, title, slug,
      summary: String(data.summary || '').trim(),
      content: String(data.content || ''),
      imageUrl,
      imageAlt: String(data.imageAlt || '').trim(),
      seoTitle: String(data.seoTitle || '').trim(),
      seoDescription: String(data.seoDescription || '').trim(),
      status,
      publishAt,
    },
  };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  if (type && !contentTypes.includes(type as ContentType)) return NextResponse.json({ message: 'Unsupported content type.' }, { status: 400 });
  const page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page') || 1)));
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
  if (!Number.isInteger(page) || !Number.isInteger(limit)) return NextResponse.json({ message: 'Invalid pagination.' }, { status: 400 });

  await connectDB();
  const filter: Record<string, unknown> = {};
  if (type) filter.type = type;
  if (!session || session.role !== 'super-admin') {
    filter.status = 'published';
    filter.$or = [{ publishAt: null }, { publishAt: { $lte: new Date() } }];
  } else if (url.searchParams.has('status')) {
    const status = url.searchParams.get('status');
    if (!['draft', 'published', 'archived'].includes(status || '')) return NextResponse.json({ message: 'Invalid content status.' }, { status: 400 });
    filter.status = status;
  }
  const search = url.searchParams.get('q')?.trim();
  if (search) filter.$text = { $search: search.slice(0, 100) };
  const [items, total] = await Promise.all([
    CmsContent.find(filter).sort({ publishAt: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    CmsContent.countDocuments(filter),
  ]);
  return NextResponse.json({ items: items.map((item) => ({ ...item, id: String(item._id) })), page, limit, total, hasMore: page * limit < total });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') return NextResponse.json({ message: 'Only the Super Admin can publish global website content.' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const validation = validateContent(body);
  if ('error' in validation) return NextResponse.json({ message: validation.error }, { status: 400 });

  await connectDB();
  try {
    const item = await CmsContent.create({ ...validation.value, createdBy: session.id, updatedBy: session.id, archivedAt: validation.value.status === 'archived' ? new Date() : null });
    await AuditLog.create({ workspaceId: null, actorId: session.id, actorRole: session.role, action: 'cms.content_created', resourceType: 'cms_content', resourceId: String(item._id), details: { type: item.type, slug: item.slug, status: item.status } });
    return NextResponse.json({ success: true, item: { id: String(item._id), type: item.type, title: item.title, slug: item.slug, status: item.status } }, { status: 201 });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return NextResponse.json({ message: 'A content item with this type and slug already exists.' }, { status: 409 });
    return NextResponse.json({ message: 'Unable to create content item.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session || session.role !== 'super-admin') return NextResponse.json({ message: 'Only the Super Admin can update global website content.' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ message: 'Request body must be valid JSON.' }, { status: 400 }); }
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ message: 'Content ID is required.' }, { status: 400 });
  const validation = validateContent(body);
  if ('error' in validation) return NextResponse.json({ message: validation.error }, { status: 400 });

  await connectDB();
  const before = await CmsContent.findById(id).lean();
  if (!before) return NextResponse.json({ message: 'Content item not found.' }, { status: 404 });
  try {
    const item = await CmsContent.findByIdAndUpdate(id, {
      $set: { ...validation.value, updatedBy: session.id, archivedAt: validation.value.status === 'archived' ? before.archivedAt || new Date() : null },
    }, { returnDocument: 'after', runValidators: true }).lean();
    if (!item) return NextResponse.json({ message: 'Content item not found.' }, { status: 404 });
    await AuditLog.create({ workspaceId: null, actorId: session.id, actorRole: session.role, action: 'cms.content_updated', resourceType: 'cms_content', resourceId: id, details: { before: { type: before.type, slug: before.slug, status: before.status }, after: { type: item.type, slug: item.slug, status: item.status } } });
    return NextResponse.json({ success: true, item: { id: String(item._id), type: item.type, title: item.title, slug: item.slug, status: item.status } });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return NextResponse.json({ message: 'A content item with this type and slug already exists.' }, { status: 409 });
    return NextResponse.json({ message: 'Unable to update content item.' }, { status: 500 });
  }
}
