import type { MetadataRoute } from 'next';
import { connectDB } from '@/lib/db';
import { CmsContent } from '@/lib/models';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL || 'https://leadgenofficial.com';
  const now = new Date();
  const urls: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
  try {
    await connectDB();
    const items = await CmsContent.find({ status: 'published', $or: [{ publishAt: null }, { publishAt: { $lte: now } }] }).select('type slug updatedAt').limit(5000).lean();
    for (const item of items) {
      const section = item.type === 'blog' ? 'blog' : item.type === 'offer' ? 'offers' : item.type === 'service' || item.type === 'free-service' ? 'services' : null;
      const contentUrl = item.type === 'page' && !['home', 'about', 'privacy', 'terms'].includes(item.slug) ? `${base}/content/${item.slug}` : section ? `${base}/${section}/${item.slug}` : null;
      if (!contentUrl) continue;
      urls.push({ url: contentUrl, lastModified: item.updatedAt || now, changeFrequency: item.type === 'blog' ? 'monthly' : 'weekly', priority: item.type === 'blog' ? 0.6 : 0.7 });
    }
  } catch {
    return urls;
  }
  return urls;
}
