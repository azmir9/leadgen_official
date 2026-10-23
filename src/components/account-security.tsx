'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AccountSecurity() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to change password.');
      router.replace('/login?passwordChanged=1');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to change password.');
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 max-w-xl border-t border-slate-200 pt-6">
      <h2 id="account-security" className="text-xl font-bold">Change password</h2>
      <form onSubmit={submit} className="mt-3 space-y-3 border-t-4 border-slate-700 bg-white p-5 shadow-sm">
        <label className="block text-sm font-medium">Current password<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium">New password<input type="password" required minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium">Confirm new password<input type="password" required minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="btn btn-secondary">{busy ? 'Updating…' : 'Update password'}</button>
      </form>
    </section>
  );
}
