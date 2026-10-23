'use client';

import Link from 'next/link';
import { useState } from 'react';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to request a reset link.');
      setMessage(result.message);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to request a reset link.'); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="card mx-auto max-w-md space-y-4 p-7"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Account recovery</p><h1 className="mt-2 text-2xl font-bold">Forgot password</h1></div><label className="block text-sm font-medium">Account email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{message && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}<button disabled={busy} className="btn btn-primary w-full">{busy ? 'Sending…' : 'Send reset link'}</button><Link href="/login" className="block text-center text-sm font-semibold text-blue-700">Return to login</Link></form>;
}

export function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      const response = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password, confirmPassword }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'This password reset link is invalid or expired.');
      setMessage(result.message);
      setPassword(''); setConfirmPassword('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to reset password.'); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="card mx-auto max-w-md space-y-4 p-7"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Account recovery</p><h1 className="mt-2 text-2xl font-bold">Set a new password</h1></div><label className="block text-sm font-medium">New password<input required minLength={12} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label><label className="block text-sm font-medium">Confirm new password<input required minLength={12} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{message && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message} <Link href="/login" className="font-semibold underline">Sign in</Link></p>}<button disabled={busy} className="btn btn-primary w-full">{busy ? 'Updating…' : 'Reset password'}</button></form>;
}
