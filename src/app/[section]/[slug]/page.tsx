import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { connectDB } from '@/lib/db';
import { CmsContent } from '@/lib/models';

const sectionTypes: Record<string, string[]> = {
  blog: ['blog'],
  services: ['service', 'free-service'],
  offers: ['offer'],
};

async function getItem(section: string, slug: string) {
  const types = sectionTypes[section];
  if (!types) return null;
  await connectDB();
  return CmsContent.findOne({ type: { $in: types }, slug, status: 'published', $or: [{ publishAt: null }, { publishAt: { $lte: new Date() } }] }).lean();
}

export async function generateMetadata({ params }: { params: Promise<{ section: string; slug: string }> }): Promise<Metadata> {
  const { section, slug } = await params;
  const item = await getItem(section, slug);
  if (!item) return { title: 'Not found | Leadgen Official', robots: { index: false, follow: false } };
  return {
    title: item.seoTitle || item.title,
    description: item.seoDescription || item.summary,
    alternates: { canonical: `/${section}/${slug}` },
    openGraph: { title: item.seoTitle || item.title, description: item.seoDescription || item.summary, images: item.imageUrl ? [{ url: item.imageUrl, alt: item.imageAlt }] : undefined, type: item.type === 'blog' ? 'article' : 'website' },
  };
}

export default async function PublicContentPage({ params }: { params: Promise<{ section: string; slug: string }> }) {
  const { section, slug } = await params;
  const item = await getItem(section, slug);
  if (!item) notFound();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <article className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm font-semibold text-blue-700">Leadgen Official</Link>
        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">{item.type.replace('-', ' ')}</p>
        <h1 className="mt-3 text-4xl font-bold">{item.title}</h1>
        {item.summary && <p className="mt-4 text-xl text-slate-600">{item.summary}</p>}
        {item.imageUrl && <Image src={item.imageUrl} alt={item.imageAlt || item.title} width={1200} height={675} unoptimized className="mt-8 max-h-[32rem] w-full object-cover" />}
        <div className="mt-8 whitespace-pre-wrap leading-7 text-slate-800">{item.content}</div>
        <p className="mt-10 border-t border-slate-200 pt-4 text-sm text-slate-500">Updated {new Date(item.updatedAt).toLocaleDateString('en-GB')}</p>
      </article>
    </main>
  );
}
