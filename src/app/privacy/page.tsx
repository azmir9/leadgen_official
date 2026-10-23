import type { Metadata } from 'next';
import Link from 'next/link';
import { connectDB } from '@/lib/db';
import { CmsContent } from '@/lib/models';

async function getLegalContent() {
  try {
    await connectDB();
    return await CmsContent.findOne({ type: 'page', slug: 'privacy', status: 'published', $or: [{ publishAt: null }, { publishAt: { $lte: new Date() } }] }).lean();
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const content = await getLegalContent();
  return {
    title: content?.seoTitle || content?.title || 'Privacy Policy | Leadgen Official',
    description: content?.seoDescription || content?.summary || 'How Leadgen Official handles account and service information.',
    alternates: { canonical: '/privacy' },
  };
}

export default async function PrivacyPage() {
  const legalContent = await getLegalContent();
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-blue-700">
          Leadgen Official
        </Link>
        <h1 className="mt-8 text-4xl font-bold">{legalContent?.title || 'Privacy Policy'}</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated: 16 October 2026</p>
        {legalContent?.content ? <div className="mt-8 whitespace-pre-wrap leading-7 text-slate-700">{legalContent.content}</div> : <div className="mt-8 space-y-7 leading-7 text-slate-700">
          <section>
            <h2 className="text-xl font-bold text-slate-900">Information we collect</h2>
            <p>
              We collect account details you provide, including your name, username,
              email address, contact and payment-account details you choose to
              provide, and information created while using assignments, reports,
              interviews, and payment features.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">How information is used</h2>
            <p>
              We use this information to operate user accounts, manage workspaces,
              deliver assignments, prepare official reports, review payable leads,
              manage interviews, and record payment clearances. Workspace records
              are restricted to authorized users for that workspace.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">Security and retention</h2>
            <p>
              Passwords are stored as hashes. Session and reset tokens are not
              stored in plaintext. Operational records and audit entries are
              retained for platform history and are not automatically deleted.
              No internet service can guarantee absolute security.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">Sharing and service providers</h2>
            <p>
              We do not sell account information. Information may be processed by
              hosting, database, and email providers necessary to operate the
              service, or disclosed when required by law. Payment transfer itself
              is handled through the selected payment provider.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">Your choices</h2>
            <p>
              You can update permitted profile fields and request account
              assistance through the official contact details shown on the website.
              Verified email changes and account deletion requests may require
              identity verification and review of legal or operational retention
              duties.
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-900">Contact</h2>
            <p>
              For privacy questions, contact the company through its official
              support links on the homepage.
            </p>
          </section>
        </div>}
      </article>
    </main>
  );
}
