'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createSubmissionLock, runWithSubmissionLock } from '@/lib/submission-lock';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submissionLock = useRef<ReturnType<typeof createSubmissionLock> | null>(null);
  if (submissionLock.current == null) submissionLock.current = createSubmissionLock();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lock = submissionLock.current;
    if (!lock) return;
    await runWithSubmissionLock(lock, async () => {
    setLoading(true);
    setError('');
    setNotice('');

    let response: Response;
    try {
      const formData = new FormData(event.currentTarget);
      const payload = {
        ...Object.fromEntries(formData.entries()),
        ...(mode === 'register' ? { invitationToken: new URLSearchParams(window.location.search).get('invite') || '' } : {}),
      };
      response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setLoading(false);
      lock.release();
      return;
    }

    let result: { message?: string; pendingApproval?: boolean; redirectTo?: string };

    try {
      result = await response.json();
    } catch (error) {
      console.error('Invalid JSON response:', error);
      setError('Server থেকে invalid response এসেছে।');
      setLoading(false);
      lock.release();
      return;
    }

    if (!response.ok) {
      setError(result.message || 'Something went wrong.');
      setLoading(false);
      lock.release();
      return;
    }

    if (result.pendingApproval) {
      setNotice(result.message || 'Registration received. Please wait for administrator approval.');
      setLoading(false);
      lock.release();
      if (result.redirectTo) {
        router.push(`${result.redirectTo}${mode === 'register' ? '?registered=1' : '?continue=1'}`);
        router.refresh();
      }
      return;
    }

    router.push('/dashboard');
    router.refresh();
    lock.release();
    });
  }

  return (
    <div className="card mx-auto max-w-xl p-8">
      <div className="mb-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Leadgen Official</p>
        <h1 className="mt-3 text-3xl font-bold">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {mode === 'register' && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Full Name</label>
            <input name="name" required className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none ring-0 transition focus:border-brand-500" placeholder="John Smith" />
          </div>
        )}

        {mode === 'login' ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Username or email</label>
            <input
              name="login"
              required
              autoComplete="username"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand-500"
              placeholder="yourusername or you@example.com"
            />
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Username</label>
              <input
                name="username"
                required
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand-500"
                placeholder="yourusername"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
              <input type="email" name="email" required className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand-500" placeholder="you@example.com" />
            </div>
          </>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input type="password" name="password" required minLength={mode === 'register' ? 12 : undefined} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand-500" placeholder="••••••••" />
        </div>

        {mode === 'register' && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Confirm Password</label>
            <input type="password" name="confirmPassword" required minLength={12} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-brand-500" placeholder="••••••••" />
          </div>
        )}

        {mode === 'login' && <div className="flex items-center justify-between text-sm"><label className="flex items-center gap-2 text-slate-700"><input type="checkbox" name="rememberMe" value="true" className="h-4 w-4 accent-blue-600" />Remember me</label><Link href="/forgot-password" className="font-semibold text-brand-600 hover:underline">Forgot password?</Link></div>}

        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

        <button type="submit" disabled={loading} className="btn btn-primary w-full py-3 disabled:cursor-not-allowed disabled:opacity-70">
          {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}
        </button>
      </form>

      <div className="mt-5 text-center text-sm text-slate-600">
        {mode === 'login' ? 'Need an account?' : 'Already have an account?'}{' '}
        <Link href={mode === 'login' ? '/register' : '/login'} className="font-semibold text-brand-600 hover:underline">
          {mode === 'login' ? 'Register here' : 'Login here'}
        </Link>
      </div>
    </div>
  );
}
