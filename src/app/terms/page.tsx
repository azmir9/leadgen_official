import type { Metadata } from 'next';
import Link from 'next/link';
import { connectDB } from '@/lib/db';
import { CmsContent } from '@/lib/models';

async function getLegalContent() {
  try {
    await connectDB();
    return await CmsContent.findOne({ type: 'page', slug: 'terms', status: 'published', $or: [{ publishAt: null }, { publishAt: { $lte: new Date() } }] }).lean();
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const content = await getLegalContent();
  return {
    title: content?.seoTitle || content?.title || 'Terms and Conditions | Leadgen Official',
    description: content?.seoDescription || content?.summary || 'Terms governing use of Leadgen Official services and platform.',
    alternates: { canonical: '/terms' },
  };
}

export default async function TermsPage() {
  const legalContent = await getLegalContent();
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-blue-700">
          Leadgen Official
        </Link>
        <h1 className="mt-8 text-4xl font-bold">{legalContent?.title || 'Terms and Conditions'}</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated: 16 October 2026</p>
        {legalContent?.content ? <div className="mt-8 whitespace-pre-wrap leading-7 text-slate-700">{legalContent.content}</div> : <div className="mt-8 space-y-7 leading-7 text-slate-700">
          <section>
            <h2 className="text-xl font-bold text-slate-900">Using the service</h2>
            <p>
              By using the Leadgen Official website or platform, you agree to provide
              accurate account information, protect your credentials, and use the
              platform only for lawful business and work activity. Access is subject
              to account status and workspace permissions.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">Accounts and workspaces</h2>
            <p>
              Workers must use their own accounts and may access only information
              made available to them. Joining links assign a registration to a
              workspace but do not grant access to an Admin account. Attempts to
              bypass permissions, impersonate another user, or access another
              workspace are prohibited.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">Reports and payments</h2>
            <p>
              Official report values and approved payable leads are distinct records.
              Payment calculations depend on workspace-approved leads, applicable
              rates, and documented adjustments. A payment clearance records its
              final breakdown and does not itself represent a bank transfer unless
              marked paid with the relevant transaction details.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">Acceptable use and content</h2>
            <p>
              Users must not upload unlawful, deceptive, harmful, or unauthorized
              content or interfere with the platform. The company may moderate public
              content and restrict accounts that violate these terms or create
              security risks.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">Availability and changes</h2>
            <p>
              The service is provided subject to maintenance and availability.
              Features, terms, and published information may change. Marketing
              services do not guarantee search rankings, leads, revenue, or other
              commercial outcomes.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">Contact</h2>
            <p>
              Questions about these terms may be directed to the official company
              contact channels listed on the homepage.
            </p>
          </section>
        </div>}
      </article>
    </main>
  );
}
