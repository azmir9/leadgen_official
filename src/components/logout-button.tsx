'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    } finally {
      router.replace('/login');
    }
  }

  return <button type="button" disabled={busy} onClick={() => void logout()} className="btn btn-secondary disabled:opacity-60">{busy ? 'Signing out…' : 'Sign out'}</button>;
}
