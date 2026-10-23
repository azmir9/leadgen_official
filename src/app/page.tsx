import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { connectDB } from '@/lib/db';
import { CmsContent, CompanySettings } from '@/lib/models';

async function getPublicContent() {
  const defaults = {
    companyName: 'Leadgen Official', description: 'Professional digital marketing and lead generation services.',
    contactEmail: 'hello@leadgenofficial.com', contactPhone: '+8801700000000',
    telegramLink: 'https://t.me/leadgenofficial', whatsappLink: 'https://wa.me/8801700000000', logoUrl: '',
  };
  try {
    await connectDB();
    const [settings, items] = await Promise.all([
      CompanySettings.findOne().lean(),
      CmsContent.find({ status: 'published', $or: [{ publishAt: null }, { publishAt: { $lte: new Date() } }] }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    return {
      branding: settings ? { companyName: settings.companyName, description: settings.description, contactEmail: settings.contactEmail, contactPhone: settings.contactPhone, telegramLink: settings.telegramLink, whatsappLink: settings.whatsappLink, logoUrl: settings.logoUrl } : defaults,
      items: items.map((item) => ({ id: String(item._id), type: item.type, title: item.title, slug: item.slug, summary: item.summary, content: item.content, imageUrl: item.imageUrl, imageAlt: item.imageAlt, seoTitle: item.seoTitle, seoDescription: item.seoDescription, updatedAt: item.updatedAt })),
    };
  } catch {
    return { branding: defaults, items: [] as { id: string; type: string; title: string; slug: string; summary: string; content: string; imageUrl: string; imageAlt: string; seoTitle: string; seoDescription: string; updatedAt: Date }[] };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { branding, items } = await getPublicContent();
  const home = items.find((item) => item.type === 'page' && item.slug === 'home');
  const base = new URL(process.env.APP_URL || 'https://leadgenofficial.com');
  return {
    title: home?.seoTitle || branding.companyName,
    description: home?.seoDescription || home?.summary || branding.description,
    alternates: { canonical: '/' },
    openGraph: { title: home?.seoTitle || branding.companyName, description: home?.seoDescription || home?.summary || branding.description, url: base, siteName: branding.companyName, type: 'website', images: branding.logoUrl ? [branding.logoUrl] : undefined },
  };
}

export default async function HomePage() {
  const { branding, items } = await getPublicContent();
  const home = items.find((item) => item.type === 'page' && item.slug === 'home');
  const about = items.find((item) => item.type === 'page' && item.slug === 'about');
  const services = items.filter((item) => item.type === 'service');
  const freeServices = items.filter((item) => item.type === 'free-service');
  const offers = items.filter((item) => item.type === 'offer');
  const banners = items.filter((item) => item.type === 'banner');
  const blogPosts = items.filter((item) => item.type === 'blog');

  return (
    <main className="public-site min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="public-header-inner container flex items-center justify-between gap-3 py-3 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            {branding.logoUrl ? <Image src={branding.logoUrl} alt={`${branding.companyName} logo`} width={40} height={40} unoptimized className="h-10 w-10 rounded object-contain" /> : <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">L</div>}
            <div className="min-w-0">
              <p className="truncate text-base font-bold sm:text-lg">{branding.companyName}</p>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 lg:flex">
            <a href="#about">About Us</a>
            <a href="#services">Services</a>
            <a href="#free-services">Free Services</a>
            <a href="#offers">Offers</a>
            <a href="#blog">Marketing Blog</a>
            <a href="#contact">Contact Us</a>
            <a href={branding.telegramLink} target="_blank" rel="noreferrer">Telegram Support</a>
          </nav>

          <div className="public-header-actions hidden shrink-0 items-center gap-3 sm:flex">
            <Link href="/login" className="btn btn-secondary">Login</Link>
            <Link href="/register" className="btn btn-primary">Get Started</Link>
          </div>

          <details className="relative ml-auto shrink-0 lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded border border-slate-300 px-3 py-2 text-sm font-semibold">Menu</summary>
            <nav className="absolute right-0 top-12 z-20 grid max-h-[calc(100dvh-5rem)] min-w-48 gap-3 overflow-y-auto border border-slate-200 bg-white p-4 text-sm shadow-lg">
              <a href="#about">About Us</a><a href="#services">Services</a><a href="#free-services">Free Services</a><a href="#offers">Offers</a><a href="#blog">Marketing Blog</a><a href="#contact">Contact Us</a><a href={branding.telegramLink}>Telegram Support</a>
              <Link href="/login" className="border-t border-slate-200 pt-3">Login</Link><Link href="/register">Get Started</Link>
            </nav>
          </details>
        </div>
      </header>

      {banners.map((banner) => <aside key={banner.id} className="border-b border-blue-200 bg-blue-50 px-4 py-3 text-center text-sm text-blue-950"><strong>{banner.title}</strong>{banner.summary && <span> · {banner.summary}</span>}</aside>)}

      <section className="public-hero container grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
        <div>
          <p className="mb-4 inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
            Growth that compounds
          </p>
          <h1 className="max-w-xl text-4xl font-black tracking-tight text-slate-900 md:text-6xl">
            {home?.title || 'Turn attention into qualified leads.'}
          </h1>
          <p className="mt-5 max-w-lg text-lg text-slate-600">
            {home?.summary || branding.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/register" className="btn btn-primary">Get Started</Link>
            <Link href="#services" className="btn btn-secondary">Explore Services</Link>
          </div>
        </div>

        <div className="public-hero-card card p-6">
          <div className="grid gap-4">
            <div className="rounded-2xl bg-slate-900 p-5 text-white">
              <p className="text-sm uppercase tracking-[0.2em] text-blue-200">Digital growth services</p>
              <p className="mt-4 text-3xl font-black">{home?.title || 'Strategy to lead flow'}</p>
              <p className="mt-2 text-sm text-slate-300">{home?.summary || 'Campaign planning, acquisition, and reporting in one team.'}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm text-slate-500">{services[0]?.title || 'Lead generation'}</p>
                <p className="mt-2 text-lg font-bold">{services[0]?.summary || 'Qualified reach'}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm text-slate-500">{services[1]?.title || 'Paid media'}</p>
                <p className="mt-2 text-lg font-bold">{services[1]?.summary || 'Measured campaigns'}</p>
              </div>
            </div>
            <p className="px-1 text-sm text-slate-600">{branding.companyName} · Digital marketing services</p>
          </div>
        </div>
      </section>

      <section id="about" className="container py-16">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">About us</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">{about?.title || 'About ' + branding.companyName}</h2>
          {about?.content && <p className="mt-4 whitespace-pre-wrap text-slate-600">{about.content}</p>}
        </div>
      </section>

      <section id="services" className="bg-slate-900 py-16 text-white">
        <div className="container">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-200">Services</p>
          <h2 className="mt-3 text-3xl font-bold">Services</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-5">
            {services.map((service) => (
              <article key={service.id} className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
                {service.imageUrl && <Image src={service.imageUrl} alt={service.imageAlt} width={640} height={360} unoptimized className="mb-4 aspect-video w-full object-cover" />}
                <h3 className="text-lg font-bold">{service.title}</h3>
                <p className="mt-3 text-sm text-slate-300">{service.summary}</p>
              </article>
            ))}
            {services.length === 0 && <p className="text-slate-300">Service information will be published here.</p>}
          </div>
        </div>
      </section>

      <section id="free-services" className="container py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Free services</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">{freeServices.map((item) => <article key={item.id} className="border-l-4 border-emerald-600 bg-white p-5"><h3 className="font-bold">{item.title}</h3><p className="mt-2 text-sm text-slate-600">{item.summary}</p></article>)}{freeServices.length === 0 && <p className="text-slate-600">No free services are currently published.</p>}</div>
      </section>

      <section id="offers" className="container py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Offers</p>
        <div className="mt-8 grid gap-6 md:grid-cols-3">{offers.map((offer) => <article key={offer.id} className="border-t-4 border-blue-600 bg-white p-6"><p className="text-sm uppercase tracking-[0.16em] text-blue-700">Offer</p><h3 className="mt-3 text-2xl font-bold">{offer.title}</h3><p className="mt-3 text-slate-600">{offer.summary}</p><Link href={`/offers/${offer.slug}`} className="mt-4 inline-block text-sm font-semibold text-blue-700">View offer</Link></article>)}{offers.length === 0 && <p className="text-slate-600">No offers are currently published.</p>}</div>
      </section>

      <section id="blog" className="bg-slate-100 py-16">
        <div className="container">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Marketing blog</p>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {blogPosts.map((post) => (
              <article key={post.id} className="border-t-4 border-slate-800 bg-white p-6">
                <p className="text-sm uppercase tracking-[0.16em] text-blue-600">Marketing</p>
                <h3 className="mt-3 text-xl font-bold text-slate-900">{post.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{post.summary}</p>
                <Link href={`/blog/${post.slug}`} className="mt-4 inline-block text-sm font-semibold text-brand-600">Read article</Link>
              </article>
            ))}
            {blogPosts.length === 0 && <p className="text-slate-600">No articles are currently published.</p>}
          </div>
        </div>
      </section>

      <section id="contact" className="container py-16">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Contact</p>
            <h2 className="mt-3 text-3xl font-bold">Let’s build your next growth channel.</h2>
            <p className="mt-4 text-slate-600">Reach the team through Telegram, WhatsApp, or email for a fast response.</p>
          </div>
          <div className="card p-6">
            <ul className="space-y-4 text-slate-700">
              <li>Email: <a href={`mailto:${branding.contactEmail}`}>{branding.contactEmail}</a></li>
              <li>Phone: <a href={`tel:${branding.contactPhone}`}>{branding.contactPhone}</a></li>
              <li>Telegram: <a href={branding.telegramLink} target="_blank" rel="noreferrer">Contact support</a></li>
              <li>WhatsApp: <a href={branding.whatsappLink} target="_blank" rel="noreferrer">Message us</a></li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="container flex flex-col gap-6 py-8 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <p>© 2026 Leadgen Official — All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms &amp; Conditions</Link>
            <a href={branding.telegramLink}>Telegram Support</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
