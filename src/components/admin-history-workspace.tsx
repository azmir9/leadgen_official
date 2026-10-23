'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import Link from 'next/link';
import { DashboardNavigation } from '@/components/dashboard-navigation';
import { LogoutButton } from '@/components/logout-button';

type HistoryEntry = {
  id: string;
  name: string;
  username: string;
  workspace: { id: string; name: string } | null;
  deletedAt: string | null;
  deletedBy: { id: string | null; name: string; username?: string; role?: string };
  previousStatus: string;
};

export function AdminHistoryWorkspace() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<HistoryEntry | null>(null);
  const [confirmation, setConfirmation] = useState('');

  async function loadHistory() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/admin-history?page=${page}&limit=25`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to load Admin History.');
      setEntries(result.entries); setTotal(result.total); setHasMore(result.hasMore);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load Admin History.'); }
    finally { setLoading(false); }
  }

  const refreshHistory = useEffectEvent(() => loadHistory());
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshHistory(); }, [page]);

  async function requestPermanentDeletion() {
    if (!target || confirmation !== 'PERMANENTLY DELETE' || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin-history/${encodeURIComponent(target.id)}/permanent-delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Permanent deletion was blocked.');
      setTarget(null); setConfirmation(''); await loadHistory();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Permanent deletion was blocked.'); }
    finally { setBusy(false); }
  }

  return <main className="dashboard-main min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-900 sm:px-6">
    <DashboardNavigation role="Super Admin" links={[
      { label: 'Overview', href: '/super-admin' }, { label: 'My Workers', href: '/super-admin/my-workers' },
      { label: 'Global Admin Overview', href: '/super-admin/admin-overview' }, { label: 'Daily Worker Orders', href: '/super-admin/daily-orders' },
      { label: 'Admin Management', href: '/super-admin/admin-management' }, { label: 'Admin History', href: '/super-admin/admin-history' },
      { label: 'Workspace Operations', href: '/super-admin/workspace-operations' }, { label: 'Official Reports', href: '/super-admin/reports' },
      { label: 'Payments', href: '/super-admin/payments' }, { label: 'Interviews', href: '/super-admin/interviews' },
      { label: 'Global Announcements', href: '/super-admin/announcements' }, { label: 'Global Branding', href: '/super-admin/branding' }, { label: 'Website CMS', href: '/super-admin/cms' },
      { label: 'Global Audit Log', href: '/super-admin/audit' }, { label: 'Account Security', href: '/super-admin/security' },
    ]} />
    <div className="mx-auto max-w-7xl">
      <header className="dashboard-page-header mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Governance · retention</p><h1 className="mt-2 text-3xl font-bold">Admin History</h1><p className="mt-1 text-sm text-slate-600">Soft-deleted Admin accounts and preserved workspace references. {total} account{total === 1 ? '' : 's'}.</p></div>
        <div className="dashboard-page-header-actions"><Link href="/super-admin#admin-management" className="btn btn-secondary">Back to Admin Management</Link><LogoutButton /></div>
      </header>
      {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <section id="admin-history" aria-label="Deleted Admin accounts" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4"><div><h2 className="font-bold">Deleted accounts</h2><p className="mt-1 text-xs text-slate-500">Personal account fields remain visible only to Super Admins under the configured retention policy.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">Page {page}</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Admin</th><th className="px-4 py-3">Workspace reference</th><th className="px-4 py-3">Deleted at · Dhaka</th><th className="px-4 py-3">Deleted by</th><th className="px-4 py-3">Previous status</th><th className="px-4 py-3">Actions</th></tr></thead><tbody>
          {entries.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{entry.name}<span className="block text-xs font-normal text-slate-500">@{entry.username}</span></td><td className="px-4 py-3">{entry.workspace?.name || 'Workspace reference retained'}<span className="block text-xs text-slate-500">{entry.workspace?.id || 'Unavailable'}</span></td><td className="px-4 py-3">{entry.deletedAt ? new Date(entry.deletedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }) : 'Date unavailable'}</td><td className="px-4 py-3">{entry.deletedBy.name}<span className="block text-xs text-slate-500">{entry.deletedBy.username ? `@${entry.deletedBy.username}` : entry.deletedBy.id || ''}</span></td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{entry.previousStatus}</span></td><td className="px-4 py-3"><div className="flex gap-2"><Link href={`/super-admin/admins/${encodeURIComponent(entry.id)}`} className="btn btn-secondary px-3 py-2 text-xs">Details / history</Link><button type="button" onClick={() => { setError(''); setConfirmation(''); setTarget(entry); }} className="rounded-xl border border-red-300 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-50">Permanent delete</button></div></td></tr>)}
          {!loading && entries.length === 0 && <tr><td colSpan={6} className="px-4 py-14 text-center text-slate-500">No deleted Admin accounts in history.</td></tr>}
          {loading && <tr><td colSpan={6} className="px-4 py-14 text-center text-slate-500">Loading Admin History…</td></tr>}
        </tbody></table></div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-3"><button disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)} className="btn btn-secondary disabled:opacity-50">Previous</button><button disabled={loading || !hasMore} onClick={() => setPage((value) => value + 1)} className="btn btn-secondary disabled:opacity-50">Next</button></div>
      </section>
    </div>
    {target && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setTarget(null); setConfirmation(''); } }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="permanent-delete-title" className="w-full max-w-xl rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-red-700">Irreversible action</p><h2 id="permanent-delete-title" className="mt-2 text-2xl font-bold">Permanently delete {target.name}?</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">This would remove personal account identifiers and credentials. Workspace ownership and business history link to this Admin by ID. Current retention safeguards block permanent deletion until an anonymization and audit-retention policy is reviewed.</p>
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">Target: {target.name} · @{target.username} · {target.workspace?.name || 'workspace retained'}</p>
        <label className="mt-4 block text-sm font-semibold">Type PERMANENTLY DELETE to continue<input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
        <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row"><button type="button" disabled={busy} onClick={() => { setTarget(null); setConfirmation(''); }} className="btn btn-secondary">Cancel</button><button type="button" disabled={busy || confirmation !== 'PERMANENTLY DELETE'} onClick={() => void requestPermanentDeletion()} className="rounded-xl bg-red-800 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Checking…' : 'Permanently delete'}</button></div>
      </section>
    </div>}
  </main>;
}
