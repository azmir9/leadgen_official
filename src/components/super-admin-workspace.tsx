'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import Link from 'next/link';
import { AccountSecurity } from '@/components/account-security';
import { CmsManager } from '@/components/cms-manager';
import { AdminFinance } from '@/components/admin-finance';
import { InterviewWorkspace } from '@/components/interview-workspace';
import { LogoutButton } from '@/components/logout-button';
import { DailyOrderOverview } from '@/components/daily-order-overview';
import { DashboardNavigation } from '@/components/dashboard-navigation';

type Admin = { id: string; name: string; username: string; email: string; status: 'active' | 'inactive' | 'blocked' | 'deleted'; accountEnabled: boolean; workspace: { id: string; name: string; isActive: boolean } | null; joinLink: { status: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null } | null };
type GlobalStats = { admins: number; workers: number; pendingWorkers: number; assignments: number; pendingOrders: number; reports: number; workspaces: number };
type Branding = { companyName: string; ownerName: string; logoUrl: string; description: string; contactEmail: string; contactPhone: string; telegramLink: string; whatsappLink: string; facebookLink: string; websiteUrl: string; announcement: string };
type AuditEntry = { id: string; workspaceId: string | null; actorRole: string; action: string; resourceType: string; resourceId: string | null; createdAt: string };
type Worker = { id: string; name: string; username: string; status: string };
type WorkspaceOption = { id: string; name: string; adminId: string };
type SuperAdminView = 'overview' | 'my-workers' | 'admin-overview' | 'daily-orders' | 'admin-management' | 'workspace-operations' | 'reports' | 'payments' | 'interviews' | 'announcements' | 'branding' | 'cms' | 'audit' | 'security';
const superAdminViewTitle = (view: SuperAdminView) => ({ overview: 'Overview', 'my-workers': 'My Workers Overview', 'admin-overview': 'Global Admin Overview', 'daily-orders': 'Daily Worker Orders', 'admin-management': 'Admin Management', 'workspace-operations': 'Workspace Operations', reports: 'Official Reports', payments: 'Payments', interviews: 'Interviews', announcements: 'Global Announcements', branding: 'Global Branding', cms: 'Website CMS', audit: 'Global Audit Log', security: 'Account Security' })[view];

function SummaryCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading ? '…' : value}</p></article>;
}

function WorkspaceSelector({ selectedWorkspace, setSelectedWorkspace, workspaces }: { selectedWorkspace: string; setSelectedWorkspace: (id: string) => void; workspaces: WorkspaceOption[] }) {
  return <label className="block max-w-xl text-sm font-medium">Workspace
    <select aria-label="Select workspace" value={selectedWorkspace} onChange={(event) => setSelectedWorkspace(event.target.value)} className="mt-1 block min-h-11 w-full rounded border border-slate-300 bg-white px-3 py-2">
      <option value="">Select workspace</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
    </select>
  </label>;
}

function WorkspacePagination({ page, hasMore, loading, setPage }: { page: number; hasMore: boolean; loading: boolean; setPage: (updater: (page: number) => number) => void }) {
  return <div className="flex flex-wrap items-center justify-end gap-3"><button className="btn btn-secondary disabled:opacity-50" disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}>Previous workspaces</button><span className="text-sm">Page {page}</span><button className="btn btn-secondary disabled:opacity-50" disabled={loading || !hasMore} onClick={() => setPage((current) => current + 1)}>Next workspaces</button></div>;
}

export function SuperAdminWorkspace({ name, workspaceId, view = 'overview', initialWorkspaceId = '' }: { name: string; workspaceId: string | null; view?: SuperAdminView; initialWorkspaceId?: string }) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminQuery, setAdminQuery] = useState('');
  const [adminStatus, setAdminStatus] = useState('');
  const [adminFrom, setAdminFrom] = useState('');
  const [adminTo, setAdminTo] = useState('');
  const [adminPage, setAdminPage] = useState(1);
  const [adminTotal, setAdminTotal] = useState(0);
  const [adminHasMore, setAdminHasMore] = useState(false);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState(initialWorkspaceId);
  const [adminPendingDeletion, setAdminPendingDeletion] = useState<Admin | null>(null);
  const [adminPendingBlock, setAdminPendingBlock] = useState<Admin | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [createForm, setCreateForm] = useState({ name: '', username: '', email: '', password: '', workspaceName: '' });
  const [expiration, setExpiration] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newLink, setNewLink] = useState('');
  const [globalReports, setGlobalReports] = useState<{ date: string; reports: { username: string; reportValue: number }[]; total: number } | null>(null);
  const [branding, setBranding] = useState<Branding>({ companyName: '', ownerName: '', logoUrl: '', description: '', contactEmail: '', contactPhone: '', telegramLink: '', whatsappLink: '', facebookLink: '', websiteUrl: '', announcement: '' });
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [workspaceWorkers, setWorkspaceWorkers] = useState<Worker[]>([]);
  const [workspaceWorkerPage, setWorkspaceWorkerPage] = useState(1);
  const [workspaceWorkerHasMore, setWorkspaceWorkerHasMore] = useState(false);
  const [workspaceWorkerTotal, setWorkspaceWorkerTotal] = useState(0);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspacePage, setWorkspacePage] = useState(1);
  const [workspaceHasMore, setWorkspaceHasMore] = useState(false);
  const [workspaceTotal, setWorkspaceTotal] = useState(0);

  async function api(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Request failed.');
    return result;
  }

  async function loadData() {
    setLoading(true); setError('');
    try {
      const adminParams = new URLSearchParams({ page: String(adminPage), limit: '25' });
      if (adminQuery) adminParams.set('q', adminQuery);
      if (adminStatus) adminParams.set('status', adminStatus);
      if (adminFrom) adminParams.set('from', adminFrom);
      if (adminTo) adminParams.set('to', adminTo);
      const [adminResult, statsResult, brandingResult, auditResult] = await Promise.all([api(`/api/admins?${adminParams}`), api(`/api/super-admin/overview?page=${workspacePage}&limit=50`), api('/api/company'), api('/api/audit?limit=50')]);
      setAdmins(adminResult.admins);
      setAdminTotal(adminResult.total);
      setAdminHasMore(adminResult.hasMore);
      setStats(statsResult.stats);
      setBranding(brandingResult);
      setAuditEntries(auditResult.entries);
      setWorkspaces(statsResult.workspaces);
      setWorkspaceHasMore(statsResult.workspaceHasMore);
      setWorkspaceTotal(statsResult.workspaceTotal);
      if (!selectedWorkspace) {
        const defaultWorkspace = statsResult.workspaces.find((item: WorkspaceOption) => item.id === workspaceId) || statsResult.workspaces[0];
        if (defaultWorkspace) setSelectedWorkspace(defaultWorkspace.id);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load platform data.'); }
    finally { setLoading(false); }
  }

  const refreshPlatformData = useEffectEvent(() => loadData());

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshPlatformData(); }, [adminPage, adminQuery, adminStatus, adminFrom, adminTo, workspacePage]);

  const loadWorkspaceWorkers = useEffectEvent(async () => {
    if (!selectedWorkspace) { setWorkspaceWorkers([]); setWorkspaceWorkerTotal(0); setWorkspaceWorkerHasMore(false); return; }
    setWorkersLoading(true);
    try {
      const result = await api(`/api/workers?workspaceId=${encodeURIComponent(selectedWorkspace)}&page=${workspaceWorkerPage}&limit=25`);
      setWorkspaceWorkers(result.workers);
      setWorkspaceWorkerHasMore(result.hasMore);
      setWorkspaceWorkerTotal(result.total);
    } catch {
      setWorkspaceWorkers([]);
      setWorkspaceWorkerTotal(0);
      setWorkspaceWorkerHasMore(false);
    } finally { setWorkersLoading(false); }
  });

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadWorkspaceWorkers(); }, [selectedWorkspace, workspaceWorkerPage]);

  function changeSelectedWorkspace(id: string) {
    setSelectedWorkspace(id);
    setWorkspaceWorkerPage(1);
    setWorkspacePage(1);
  }

  async function createAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api('/api/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createForm) });
      setCreateForm({ name: '', username: '', email: '', password: '', workspaceName: '' });
      setNotice('Admin account and isolated workspace created.'); await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to create Admin.'); }
    finally { setBusy(false); }
  }

  async function generateLink(adminId: string) {
    setBusy(true); setError(''); setNotice(''); setNewLink('');
    try {
      const body = expiration ? { expiresInDays: Number(expiration) } : {};
      const result = await api(`/api/admins/${encodeURIComponent(adminId)}/joining-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setNewLink(result.link.url); setNotice('Joining link generated and previous active link revoked.'); await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to generate joining link.'); }
    finally { setBusy(false); }
  }

  async function revokeLink(adminId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/api/admins/${encodeURIComponent(adminId)}/joining-link`, { method: 'DELETE' });
      setNotice('Joining link revoked.'); setNewLink(''); await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to revoke joining link.'); }
    finally { setBusy(false); }
  }

  async function changeAdminStatus(adminId: string, status: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/api/admins/${encodeURIComponent(adminId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      setNotice(`Admin ${status}.${result.revokedLinks ? ` Revoked ${result.revokedLinks} joining link(s).` : ''}`);
      await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update Admin status.'); }
    finally { setBusy(false); }
  }

  async function deleteAdminAccount() {
    if (!adminPendingDeletion || deleteConfirmation !== 'DELETE' || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/api/admins/${encodeURIComponent(adminPendingDeletion.id)}`, { method: 'DELETE' });
      setNotice(`Admin account moved to History. ${result.revokedSessions} session(s) and ${result.revokedLinks} joining link(s) revoked. Workspace and historical records were preserved.`);
      setAdminPendingDeletion(null); setDeleteConfirmation('');
      await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to move Admin account to History.'); }
    finally { setBusy(false); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); }
    catch { setError('Clipboard access is unavailable. Select and copy the link manually.'); }
  }

  async function loadWorkspaceReports() {
    if (!selectedWorkspace) return;
    setBusy(true); setError('');
    try {
      const todayDhaka = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
      setGlobalReports(await api(`/api/reports?workspaceId=${encodeURIComponent(selectedWorkspace)}&date=${todayDhaka}`));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load reports.'); }
    finally { setBusy(false); }
  }

  async function saveBranding(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api('/api/company', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(branding) });
      setNotice('Official company settings saved.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save company settings.'); }
    finally { setBusy(false); }
  }

  const metricCards = stats ? [
    ['Admin accounts', stats.admins], ['Workspaces', stats.workspaces], ['Workers', stats.workers],
    ['Pending approvals', stats.pendingWorkers], ['Active assignments', stats.assignments], ['Pending orders', stats.pendingOrders], ['Official reports', stats.reports],
  ] as const : [];
  return (
    <main className="dashboard-main min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-900 sm:px-6">
      <DashboardNavigation role="Super Admin" workspaceId={selectedWorkspace} links={[
        { label: 'Overview', href: '/super-admin' }, { label: 'My Workers', href: '/super-admin/my-workers' },
        { label: 'Global Admin Overview', href: '/super-admin/admin-overview' }, { label: 'Daily Worker Orders', href: '/super-admin/daily-orders' },
        { label: 'Admin Management', href: '/super-admin/admin-management' }, { label: 'Admin History', href: '/super-admin/admin-history' },
        { label: 'Workspace Operations', href: '/super-admin/workspace-operations' }, { label: 'Official Reports', href: '/super-admin/reports' },
        { label: 'Payments', href: '/super-admin/payments' }, { label: 'Interviews', href: '/super-admin/interviews' },
        { label: 'Global Announcements', href: '/super-admin/announcements' }, { label: 'Global Branding', href: '/super-admin/branding' }, { label: 'Website CMS', href: '/super-admin/cms' },
        { label: 'Global Audit Log', href: '/super-admin/audit' }, { label: 'Account Security', href: '/super-admin/security' },
      ]} />
      <div className="mx-auto max-w-7xl">
        <header className="dashboard-page-header mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Leadgen Official · Company owner</p><h1 className="mt-2 text-3xl font-bold">{superAdminViewTitle(view)}</h1><p className="mt-1 text-sm text-slate-600">{name} · {workspaceId ? 'owner workspace configured' : 'owner workspace needs setup'}</p></div><div className="dashboard-page-header-actions"><LogoutButton /></div></header>
        {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {view === 'overview' && <>
          <section id="platform-overview" aria-label="Platform overview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metricCards.map(([label, value]) => <div key={label} className="border-l-4 border-blue-600 bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold">{loading ? '…' : value}</p></div>)}</section>
          <section className="mt-7 grid gap-4 md:grid-cols-2">
            <Link href="/super-admin/my-workers" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold">My Workers Overview</h2><p className="mt-1 text-sm text-slate-600">Workers attached to the selected workspace: {workspaceWorkers.length}</p><span className="mt-3 inline-block font-semibold text-blue-700">Open worker overview →</span></Link>
            <Link href="/super-admin/admin-overview" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold">Global Admin Overview</h2><p className="mt-1 text-sm text-slate-600">{stats?.admins ?? 0} Admin accounts across authorized workspaces.</p><span className="mt-3 inline-block font-semibold text-blue-700">Open global overview →</span></Link>
            <div className="md:col-span-2"><h2 className="mb-2 text-lg font-bold">Shortcuts</h2><div className="flex flex-wrap gap-2">{[['Daily Worker Orders', '/super-admin/daily-orders'], ['Admin Management', '/super-admin/admin-management'], ['Workspace Operations', '/super-admin/workspace-operations'], ['Reports', '/super-admin/reports'], ['Payments', '/super-admin/payments'], ['Global Audit Log', '/super-admin/audit']].map(([label, href]) => <Link key={href} href={href} className="btn btn-secondary">{label}</Link>)}</div></div>
          </section>
        </>}
        {view === 'daily-orders' && <><WorkspaceSelector selectedWorkspace={selectedWorkspace} setSelectedWorkspace={changeSelectedWorkspace} workspaces={workspaces} /><DailyOrderOverview workspaceId={selectedWorkspace || workspaceId} title="Workspace Daily Worker Orders" /></>}
        {newLink && view === 'admin-management' && <div className="mb-5 border-l-4 border-emerald-600 bg-white p-4"><label htmlFor="generated-link" className="text-sm font-semibold">New joining link</label><input id="generated-link" readOnly value={newLink} className="mt-2 w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm" /><button onClick={() => void copy(newLink)} className="btn btn-secondary mt-2">Copy link</button></div>}

        {view === 'my-workers' && <section aria-label="My Workers Overview" className="space-y-4"><WorkspaceSelector selectedWorkspace={selectedWorkspace} setSelectedWorkspace={changeSelectedWorkspace} workspaces={workspaces} /><WorkspacePagination page={workspacePage} hasMore={workspaceHasMore} loading={loading} setPage={setWorkspacePage} /><div className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Workers in selected workspace" value={workspaceWorkerTotal} loading={workersLoading} /><SummaryCard label="Active Workers on page" value={workspaceWorkers.filter((worker) => worker.status === 'active').length} loading={workersLoading} /><SummaryCard label="Pending Workers on page" value={workspaceWorkers.filter((worker) => worker.status === 'pending').length} loading={workersLoading} /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{workspaceWorkers.map((worker) => <article key={worker.id} className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-bold">{worker.name}</h2><p className="text-sm text-slate-600">@{worker.username}</p><span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{worker.status}</span></article>)}{!workersLoading && workspaceWorkers.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No Workers found in this workspace.</p>}</div><div className="flex items-center justify-end gap-3"><button className="btn btn-secondary disabled:opacity-50" disabled={workspaceWorkerPage <= 1 || workersLoading} onClick={() => setWorkspaceWorkerPage((page) => page - 1)}>Previous Workers</button><span className="text-sm">Worker page {workspaceWorkerPage}</span><button className="btn btn-secondary disabled:opacity-50" disabled={!workspaceWorkerHasMore || workersLoading} onClick={() => setWorkspaceWorkerPage((page) => page + 1)}>Next Workers</button></div></section>}
        {view === 'admin-overview' && <section aria-label="Global Admin Overview" className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Total Admin accounts" value={stats?.admins ?? 0} loading={loading} /><SummaryCard label="Workspaces" value={stats?.workspaces ?? 0} loading={loading} /><SummaryCard label="Admins on this page" value={admins.length} loading={loading} /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{admins.map((admin) => <article key={admin.id} className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-bold">{admin.name}</h2><p className="text-sm text-slate-600">@{admin.username}</p><p className="mt-1 text-sm text-slate-600">{admin.workspace?.name || 'Workspace not configured'}</p><span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{admin.status}</span></article>)}{!loading && admins.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No Admin accounts on this page.</p>}</div><div className="flex flex-wrap items-center justify-end gap-3"><button className="btn btn-secondary disabled:opacity-50" disabled={loading || adminPage <= 1} onClick={() => setAdminPage((page) => page - 1)}>Previous</button><span className="text-sm">Page {adminPage}</span><button className="btn btn-secondary disabled:opacity-50" disabled={loading || !adminHasMore} onClick={() => setAdminPage((page) => page + 1)}>Next</button><Link href="/super-admin/admin-management" className="btn btn-secondary">Manage Admin accounts</Link></div></section>}

        {view === 'admin-management' && <section className="mt-8 grid gap-8 xl:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="mb-3 text-xl font-bold">Create Admin</h2>
            <form onSubmit={createAdmin} className="space-y-3 border-t-4 border-blue-600 bg-white p-5 shadow-sm">
              <label className="block text-sm font-medium">Display name<input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value, workspaceName: createForm.workspaceName || `${event.target.value}'s Workspace` })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
              <label className="block text-sm font-medium">Username<input required pattern="[a-zA-Z0-9._-]{3,30}" value={createForm.username} onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
              <label className="block text-sm font-medium">Email<input required type="email" value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
              <label className="block text-sm font-medium">Temporary password<input required minLength={12} type="password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
              <label className="block text-sm font-medium">Workspace name<input required value={createForm.workspaceName} onChange={(event) => setCreateForm({ ...createForm, workspaceName: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
              <button disabled={busy} className="btn btn-primary w-full">Create Admin workspace</button>
            </form>
          </div>

          <div id="admin-management">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Admin management <span className="text-sm font-normal text-slate-500">({adminTotal})</span></h2><p className="mt-1 text-xs text-slate-500">Online status is derived from a valid session or recent authenticated activity. Inactivity does not block sign-in.</p></div><div className="flex items-center gap-2"><label htmlFor="expiry" className="text-xs text-slate-600">Link expiry days</label><input id="expiry" type="number" min="1" max="365" value={expiration} onChange={(event) => setExpiration(event.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1" placeholder="Never" /></div></div>
            <form onSubmit={(event) => { event.preventDefault(); setAdminPage(1); setAdminQuery(adminSearch.trim()); }} className="mb-3 flex flex-wrap gap-2"><label className="sr-only" htmlFor="admin-search">Search Admins</label><input id="admin-search" value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} placeholder="Search name, username, email" className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm" /><label className="sr-only" htmlFor="admin-status">Filter Admin status</label><select id="admin-status" value={adminStatus} onChange={(event) => { setAdminStatus(event.target.value); setAdminPage(1); }} className="rounded border border-slate-300 bg-white px-2 py-2 text-sm"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option></select><label className="sr-only" htmlFor="admin-from">Created from</label><input id="admin-from" type="date" aria-label="Admin created from" value={adminFrom} onChange={(event) => { setAdminFrom(event.target.value); setAdminPage(1); }} className="rounded border border-slate-300 px-2 py-2 text-sm" /><label className="sr-only" htmlFor="admin-to">Created to</label><input id="admin-to" type="date" aria-label="Admin created to" value={adminTo} onChange={(event) => { setAdminTo(event.target.value); setAdminPage(1); }} className="rounded border border-slate-300 px-2 py-2 text-sm" /><button className="btn btn-secondary">Apply filters</button></form>
            <div className="space-y-3">{admins.map((admin) => <article key={admin.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{admin.name} <span className="font-normal text-slate-500">@{admin.username}</span></h3><p className="text-sm text-slate-600">{admin.email}</p><p className="mt-1"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${admin.status === 'active' ? 'bg-emerald-100 text-emerald-800' : admin.status === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`}>{admin.status === 'active' ? 'Active' : admin.status === 'blocked' ? 'Blocked' : 'Inactive'}</span>{!admin.accountEnabled && admin.status === 'inactive' && <span className="ml-2 text-xs text-amber-700">Sign-in disabled</span>}</p><p className="mt-2 text-sm text-slate-600">Workspace: {admin.workspace?.name || 'Not configured'}{admin.workspace && !admin.workspace.isActive ? ' · inactive' : ''}</p><p className="mt-1 text-xs text-slate-500">Joining link: {admin.joinLink?.status || 'not generated'}{admin.joinLink?.lastUsedAt ? ` · Last used ${new Date(admin.joinLink.lastUsedAt).toLocaleString()}` : ''}</p></div><div className="flex flex-wrap gap-2"><button disabled={busy || !admin.accountEnabled || admin.status === 'blocked' || !admin.workspace} onClick={() => void generateLink(admin.id)} className="btn btn-secondary">{admin.joinLink ? 'Rotate link' : 'Generate link'}</button>{admin.joinLink && <button disabled={busy} onClick={() => void revokeLink(admin.id)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">Revoke link</button>}{admin.workspace && <Link href={`/super-admin/workspace-operations?workspace=${encodeURIComponent(admin.workspace.id)}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Inspect</Link>}<Link href={`/super-admin/admins/${encodeURIComponent(admin.id)}`} className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-800">Details</Link>{admin.status === 'blocked' ? <button disabled={busy} onClick={() => void changeAdminStatus(admin.id, 'active')} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Unblock account</button> : admin.accountEnabled ? <button disabled={busy} onClick={() => setAdminPendingBlock(admin)} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Block account</button> : <button disabled={busy} onClick={() => void changeAdminStatus(admin.id, 'active')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Enable account</button>}<button disabled={busy} onClick={() => { setDeleteConfirmation(''); setAdminPendingDeletion(admin); }} className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 disabled:cursor-not-allowed disabled:opacity-50">Delete account</button></div></div></article>)}{!loading && admins.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No Admin accounts on this page.</p>}</div>
            <div className="mt-3 flex justify-end gap-2"><button disabled={adminPage <= 1} onClick={() => setAdminPage((page) => page - 1)} className="btn btn-secondary disabled:opacity-50">Previous</button><span className="px-2 py-2 text-sm">Page {adminPage}</span><button disabled={!adminHasMore} onClick={() => setAdminPage((page) => page + 1)} className="btn btn-secondary disabled:opacity-50">Next</button></div>
          </div>
        </section>}

        {view === 'workspace-operations' && <section id="selected-workspace-operations" className="mt-9 space-y-4 border-t border-slate-200 pt-7">
          <h2 className="text-xl font-bold">Workspace management</h2>
          <WorkspaceSelector selectedWorkspace={selectedWorkspace} setSelectedWorkspace={changeSelectedWorkspace} workspaces={workspaces} />
          {selectedWorkspace ? <div className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-bold">{workspaces.find((workspace) => workspace.id === selectedWorkspace)?.name || 'Selected workspace'}</h3><p className="mt-1 break-all text-sm text-slate-600">Workspace ID: {selectedWorkspace}</p><p className="mt-1 text-sm text-slate-600">Workers currently loaded for this workspace: {workspaceWorkers.length}</p><div className="mt-4 flex flex-wrap gap-2"><Link href={`/super-admin/my-workers?workspace=${encodeURIComponent(selectedWorkspace)}`} className="btn btn-secondary">My Workers</Link><Link href={`/super-admin/daily-orders?workspace=${encodeURIComponent(selectedWorkspace)}`} className="btn btn-secondary">Daily Orders</Link><Link href={`/super-admin/reports?workspace=${encodeURIComponent(selectedWorkspace)}`} className="btn btn-secondary">Reports</Link><Link href={`/super-admin/payments?workspace=${encodeURIComponent(selectedWorkspace)}`} className="btn btn-secondary">Payments</Link></div></div> : <p className="rounded-xl bg-white p-4 text-sm text-slate-600">Select a workspace to inspect its authorized operational overview.</p>}
        </section>}
        {view === 'payments' && <section className="mt-9 space-y-4"><h2 className="text-xl font-bold">Global payment oversight</h2><WorkspaceSelector selectedWorkspace={selectedWorkspace} setSelectedWorkspace={changeSelectedWorkspace} workspaces={workspaces} /><AdminFinance key="global-payment-history" workspaceId={null} />{selectedWorkspace && <AdminFinance key={`workspace-payment-history-${selectedWorkspace}`} workspaceId={selectedWorkspace} />}</section>}
        {view === 'interviews' && <section className="mt-9 space-y-4"><h2 className="text-xl font-bold">Workspace interviews</h2><WorkspaceSelector selectedWorkspace={selectedWorkspace} setSelectedWorkspace={changeSelectedWorkspace} workspaces={workspaces} />{selectedWorkspace ? <InterviewWorkspace key={`interviews-${selectedWorkspace}`} mode="super-admin" workspaceId={selectedWorkspace} workers={workspaceWorkers} /> : <p className="rounded-xl bg-white p-4 text-sm text-slate-600">Select a workspace to review interviews.</p>}</section>}
        {view === 'reports' && <section id="workspace-report-inspection" className="mt-9 border-t border-slate-200 pt-7"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">Workspace report inspection</h2><p className="mt-1 text-sm text-slate-600">Select a workspace to view report data. {workspaceTotal} workspaces total.</p></div><div className="flex flex-wrap gap-2"><select aria-label="Report workspace" value={selectedWorkspace} onChange={(event) => { changeSelectedWorkspace(event.target.value); setGlobalReports(null); }} className="max-w-full rounded border border-slate-300 bg-white px-3 py-2"><option value="">Select workspace</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><button disabled={busy || !selectedWorkspace} onClick={() => void loadWorkspaceReports()} className="btn btn-primary">Load reports</button></div></div>
          {globalReports && <div className="mt-4 overflow-x-auto border border-slate-200 bg-white"><div className="flex flex-wrap justify-between gap-2 px-4 py-3"><span className="font-semibold">{globalReports.date} · Report total {globalReports.total}</span><span>{globalReports.reports.length} entries</span></div><table className="w-full min-w-[420px] text-left text-sm"><thead className="bg-slate-100"><tr><th className="px-4 py-2">Username</th><th className="px-4 py-2">Official report value</th></tr></thead><tbody>{globalReports.reports.map((report) => <tr key={report.username} className="border-t"><td className="px-4 py-2">{report.username}</td><td className="px-4 py-2">{report.reportValue}</td></tr>)}{globalReports.reports.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-slate-500">No reports for this workspace today.</td></tr>}</tbody></table></div>}
        </section>}

        {view === 'announcements' && <section className="mt-9 border-t border-slate-200 pt-7"><h2 className="text-xl font-bold">Company-wide announcement</h2><p className="mt-1 text-sm text-slate-600">This message is shared across all Worker workspaces.</p><form onSubmit={saveBranding} className="mt-4 grid gap-3 border-t-4 border-blue-600 bg-white p-5"><label className="block text-sm font-medium">Announcement<textarea value={branding.announcement} onChange={(event) => setBranding({ ...branding, announcement: event.target.value })} rows={4} maxLength={2000} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label><button disabled={busy} className="btn btn-primary">Save announcement</button></form></section>}
        {view === 'branding' && <section id="company-branding" className="mt-9 scroll-mt-20 border-t border-slate-200 pt-7">
          <h2 className="text-xl font-bold">Official company branding</h2>
          <p className="mt-1 text-sm text-slate-600">These settings define the same company identity seen by workers in every workspace.</p>
          <form onSubmit={saveBranding} className="mt-4 grid gap-3 border-t-4 border-emerald-600 bg-white p-5 shadow-sm sm:grid-cols-2">
            {([['companyName', 'Company name'], ['ownerName', 'Owner display name'], ['contactEmail', 'Official email'], ['contactPhone', 'Official phone'], ['logoUrl', 'Logo URL'], ['websiteUrl', 'Website URL'], ['telegramLink', 'Telegram support URL'], ['whatsappLink', 'WhatsApp URL'], ['facebookLink', 'Facebook page URL']] as const).map(([key, label]) => <label key={key} className="block text-sm font-medium">{label}<input value={branding[key]} onChange={(event) => setBranding({ ...branding, [key]: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>)}
            <label className="block text-sm font-medium sm:col-span-2">Company description<textarea value={branding.description} onChange={(event) => setBranding({ ...branding, description: event.target.value })} rows={3} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
            <button disabled={busy} className="btn btn-primary sm:col-span-2">Save official branding</button>
          </form>
        </section>}
        {view === 'cms' && <CmsManager />}
        {view === 'audit' && <section id="global-audit-log" className="mt-9 scroll-mt-20 border-t border-slate-200 pt-7">
          <h2 className="mb-3 text-xl font-bold">Global audit log</h2>
          <div className="overflow-x-auto border border-slate-200 bg-white"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-3">Time</th><th className="px-3 py-3">Workspace</th><th className="px-3 py-3">Actor role</th><th className="px-3 py-3">Action</th><th className="px-3 py-3">Resource</th></tr></thead><tbody>{auditEntries.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="px-3 py-2">{new Date(entry.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</td><td className="px-3 py-2">{entry.workspaceId || 'Global'}</td><td className="px-3 py-2">{entry.actorRole}</td><td className="px-3 py-2">{entry.action}</td><td className="px-3 py-2">{entry.resourceType}</td></tr>)}{!loading && auditEntries.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No logged actions yet.</td></tr>}</tbody></table></div>
        </section>}
        {view === 'security' && <AccountSecurity />}
      </div>
      {adminPendingBlock && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setAdminPendingBlock(null); }}>
        <section role="alertdialog" aria-modal="true" aria-labelledby="block-admin-title" className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-800">Access control</p><h2 id="block-admin-title" className="mt-2 text-2xl font-bold">Block {adminPendingBlock.name}?</h2>
          <p className="mt-3 text-sm leading-6 text-slate-700">Blocking prevents sign-in and invalidates all current sessions. The account stays blocked until you explicitly unblock it. The Admin’s workspace and historical records are preserved.</p>
          <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row"><button type="button" disabled={busy} onClick={() => setAdminPendingBlock(null)} className="btn btn-secondary">Cancel</button><button type="button" disabled={busy} onClick={() => { void changeAdminStatus(adminPendingBlock.id, 'blocked').then(() => setAdminPendingBlock(null)); }} className="rounded-xl bg-amber-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Blocking…' : 'Confirm block'}</button></div>
        </section>
      </div>}
      {adminPendingDeletion && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setAdminPendingDeletion(null); setDeleteConfirmation(''); } }}>
        <section role="alertdialog" aria-modal="true" aria-labelledby="delete-admin-title" aria-describedby="delete-admin-description" className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">Admin account action</p>
          <h2 id="delete-admin-title" className="mt-2 text-2xl font-bold text-slate-900">Move {adminPendingDeletion.name} to Admin History?</h2>
          <p id="delete-admin-description" className="mt-3 text-sm leading-6 text-slate-600">The account will disappear from the normal Admin list, cannot sign in, and its sessions and joining links will be revoked. The workspace, workers, reports, payments, assignments, and audit history will be preserved. Permanent deletion is a separate restricted action in Admin History.</p>
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900">Account: {adminPendingDeletion.name} · @{adminPendingDeletion.username} · {adminPendingDeletion.email}</p>
          <label className="mt-4 block text-sm font-semibold text-slate-800">Type DELETE to confirm<input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
          <div className="mt-6 flex flex-col-reverse justify-end gap-2 sm:flex-row"><button type="button" disabled={busy} onClick={() => { setAdminPendingDeletion(null); setDeleteConfirmation(''); }} className="btn btn-secondary">Cancel</button><button type="button" disabled={busy || deleteConfirmation !== 'DELETE'} onClick={() => void deleteAdminAccount()} className="rounded-xl bg-red-700 px-4 py-3 font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Moving to history…' : 'Confirm soft delete'}</button></div>
        </section>
      </div>}
    </main>
  );
}
