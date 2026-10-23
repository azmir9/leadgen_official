import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { connectDB } from '@/lib/db';
import { CmsContent } from '@/lib/models';

async function getPageContent(slug: string) {
  await connectDB();
  return CmsContent.findOne({ type: 'page', slug, status: 'published', $or: [{ publishAt: null }, { publishAt: { $lte: new Date() } }] }).lean();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPageContent(slug);
  if (!page) return { title: 'Not found | Leadgen Official', robots: { index: false, follow: false } };
  return {
    title: page.seoTitle || page.title,
    description: page.seoDescription || page.summary,
    alternates: { canonical: `/content/${slug}` },
    openGraph: { title: page.seoTitle || page.title, description: page.seoDescription || page.summary, images: page.imageUrl ? [{ url: page.imageUrl, alt: page.imageAlt }] : undefined },
  };
}

export default async function CmsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPageContent(slug);
  if (!page || ['home', 'about', 'privacy', 'terms'].includes(slug)) notFound();
  return <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900"><article className="mx-auto max-w-4xl"><Link href="/" className="text-sm font-semibold text-blue-700">Leadgen Official</Link><h1 className="mt-8 text-4xl font-bold">{page.title}</h1>{page.summary && <p className="mt-4 text-xl text-slate-600">{page.summary}</p>}{page.imageUrl && <Image src={page.imageUrl} alt={page.imageAlt || page.title} width={1200} height={675} unoptimized className="mt-8 max-h-[32rem] w-full object-cover" />}<div className="mt-8 whitespace-pre-wrap leading-7 text-slate-800">{page.content}</div></article></main>;
}
