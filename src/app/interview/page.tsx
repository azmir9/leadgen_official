import type { Metadata } from 'next';
import { InterviewWorkspace } from '@/components/interview-workspace';

export const metadata: Metadata = { title: 'Worker Interview | Leadgen Official', robots: { index: false, follow: false } };

export default async function WorkerOnboardingInterviewPage({ searchParams }: { searchParams: Promise<{ registered?: string }> }) {
  const { registered } = await searchParams;
  return <main className="auth-shell min-h-screen bg-slate-100 px-4 py-8 sm:py-12">
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Leadgen Official</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">Worker Interview</h1>
        <p className="mt-2 text-sm text-slate-600">Complete your work profile for your workspace Admin to review.</p>
      </header>
      {registered === '1' && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center font-semibold text-emerald-900">Registration Successful! Your account is pending approval. Complete your interview to continue.</p>}
      <InterviewWorkspace mode="onboarding" />
    </div>
  </main>;
}
