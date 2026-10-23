'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import Link from 'next/link';
import { AccountSecurity } from '@/components/account-security';
import { AdminFinance } from '@/components/admin-finance';
import { InterviewWorkspace } from '@/components/interview-workspace';
import { LogoutButton } from '@/components/logout-button';
import { DailyOrderOverview } from '@/components/daily-order-overview';
import { DashboardNavigation } from '@/components/dashboard-navigation';

type Worker = { id: string; name: string; username: string; email: string; status: string };
type Order = { id: string; workerId: string; workerName: string | null; requestedQuantity: number; deliveredQuantity: number; pendingQuantity: number; status: string };
type Assignment = { id: string; workerId: string; workerName: string | null; username: string; status: string; lastStopTime: string | null };
type ReassignmentRequired = { username: string; workerId: string };
type AuditEntry = { id: string; actorRole: string; action: string; resourceType: string; resourceId: string | null; details: Record<string, unknown>; createdAt: string };
type JoinLink = { url: string; status: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null } | null;
type WorkspaceAnnouncement = { id: string; message: string; createdAt: string; updatedAt: string };
type Preview = { rows: { line: number; username: string; reportValue: number; existingValue: number | null; unassigned: boolean }[]; invalid: { line: number; input: string; reason: string }[]; duplicates: { line: number; username: string }[]; summary: { new: number; updates: number; invalid: number; duplicates: number; unassigned: number; skippedUnassigned?: number } };
type ReportHistory = { id: string; username: string; previousValue: number; nextValue: number; changedBy: string; changedAt: string }[];
const adminViewTitle = (view: AdminView) => ({ overview: 'Overview', workers: 'My Workers', 'daily-orders': 'Daily Worker Orders', assignments: 'Assigned Users', reports: 'Official Reports', orders: 'All Orders', workspace: 'Workspace Settings', announcements: 'Announcements', audit: 'Audit Log', payments: 'Payments', interviews: 'Interviews', security: 'Account Security' })[view];

type AdminView = 'overview' | 'workers' | 'daily-orders' | 'assignments' | 'reports' | 'orders' | 'workspace' | 'announcements' | 'audit' | 'payments' | 'interviews' | 'security';

export function AdminWorkspace({ name, workspaceId, view = 'overview' }: { name: string; workspaceId: string | null; view?: AdminView }) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [joinLink, setJoinLink] = useState<JoinLink>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [announcements, setAnnouncements] = useState<WorkspaceAnnouncement[]>([]);
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [editingAnnouncementId, setEditingAnnouncementId] = useState('');
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerQuery, setWorkerQuery] = useState('');
  const [workerStatus, setWorkerStatus] = useState('');
  const [workerFrom, setWorkerFrom] = useState('');
  const [workerTo, setWorkerTo] = useState('');
  const [workerPage, setWorkerPage] = useState(1);
  const [workerTotal, setWorkerTotal] = useState(0);
  const [workerHasMore, setWorkerHasMore] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState('');
  const [usernames, setUsernames] = useState('');
  const [lastStopTime, setLastStopTime] = useState('');
  const [reassignmentConfirmation, setReassignmentConfirmation] = useState<{ workerId: string; assignments: ReassignmentRequired[] } | null>(null);
  const [orderDelivery, setOrderDelivery] = useState<Record<string, string>>({});
  const [reportDate, setReportDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()));
  const [reportText, setReportText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [reportHistory, setReportHistory] = useState<ReportHistory | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function requestJson(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Request failed.');
    return result;
  }

  async function loadData() {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const workerParams = new URLSearchParams({ page: String(workerPage), limit: '25' });
      if (workerQuery) workerParams.set('q', workerQuery);
      if (workerStatus) workerParams.set('status', workerStatus);
      if (workerFrom) workerParams.set('from', workerFrom);
      if (workerTo) workerParams.set('to', workerTo);
      const [workerData, orderData, assignmentData, linkData, auditData, announcementData, workspaceData] = await Promise.all([
        requestJson(`/api/workers?${workerParams}`), requestJson('/api/orders'), requestJson('/api/assignments'), requestJson('/api/admins'), requestJson('/api/audit?limit=50'), requestJson('/api/announcements'), requestJson('/api/workspace/settings'),
      ]);
      setWorkers(workerData.workers);
      setWorkerTotal(workerData.total);
      setWorkerHasMore(workerData.hasMore);
      setOrders(orderData.orders);
      setAssignments(assignmentData.assignments);
      setJoinLink(linkData.links[0] || null);
      setAuditEntries(auditData.entries);
      setAnnouncements(announcementData.announcements);
      setWorkspaceName(workspaceData.name);
      setWorkspaceNameDraft(workspaceData.name);
      if (!selectedWorker && workerData.workers.length) setSelectedWorker(workerData.workers.find((worker: Worker) => worker.status === 'active')?.id || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load workspace data.');
    } finally {
      setLoading(false);
    }
  }

  const refreshWorkspaceData = useEffectEvent(() => loadData());

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshWorkspaceData(); }, [workspaceId, workerPage, workerQuery, workerStatus, workerFrom, workerTo]);

  async function updateWorker(workerId: string, status: string) {
    setBusy(true); setNotice(''); setError('');
    try {
      await requestJson('/api/workers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId, status }) });
      setNotice(`Worker ${status}.`); await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update worker.'); }
    finally { setBusy(false); }
  }

  async function fulfillOrder(orderId: string, currentDelivered: number, pendingQuantity: number) {
    const amount = Number(orderDelivery[orderId] ?? pendingQuantity);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > pendingQuantity) { setError('Delivery amount must be a whole number within the pending quantity.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await requestJson('/api/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, deliveredQuantity: currentDelivered + amount }) });
      setNotice('Order delivery saved.'); await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to fulfill order.'); }
    finally { setBusy(false); }
  }

  async function assignUsernames(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      setReassignmentConfirmation(null);
      const response = await fetch('/api/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: selectedWorker, usernames, lastStopTime: lastStopTime || null }) });
      const result = await response.json();
      if (result.reassignmentsRequired?.length) {
        setReassignmentConfirmation({ workerId: selectedWorker, assignments: result.reassignmentsRequired });
      }
      if (!response.ok && !result.requiresOverrideConfirmation) throw new Error(result.message || 'Unable to assign usernames.');
      setNotice(result.requiresOverrideConfirmation
        ? 'Review the usernames below and confirm before moving them to this Worker.'
        : `Assigned ${result.inserted} usernames.${result.duplicates.length ? ` Skipped duplicates: ${result.duplicates.join(', ')}` : ''}`);
      if (response.ok) setUsernames('');
      await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to assign usernames.'); }
    finally { setBusy(false); }
  }

  async function confirmReassignment() {
    if (!reassignmentConfirmation) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await requestJson('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerId: reassignmentConfirmation.workerId,
          usernames: reassignmentConfirmation.assignments.map((assignment) => assignment.username).join('\n'),
          lastStopTime: lastStopTime || null,
          override: true,
          expectedAssignments: reassignmentConfirmation.assignments,
        }),
      });
      setReassignmentConfirmation(null);
      setNotice(`Reassigned ${result.reassigned.length} usernames. The previous assignment history was retained.`);
      await loadData();
    } catch (caught) {
      setReassignmentConfirmation(null);
      setError(caught instanceof Error ? caught.message : 'Unable to reassign usernames. Refresh assignments and try again.');
    } finally { setBusy(false); }
  }

  async function previewReports() {
    setBusy(true); setError(''); setNotice(''); setPreview(null); setOverwrite(false);
    try {
      const result = await requestJson('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', date: reportDate, data: reportText }) });
      setPreview(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to preview report.'); }
    finally { setBusy(false); }
  }

  async function loadReportHistory() {
    setBusy(true); setError('');
    try {
      const result = await requestJson(`/api/reports?date=${encodeURIComponent(reportDate)}&history=true`);
      setReportHistory(result.history || []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load report correction history.'); }
    finally { setBusy(false); }
  }

  async function saveReports() {
    if (!preview) return;
    if (preview.summary.updates && !overwrite) { setError('Confirm the overwrite checkbox before saving existing report corrections.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', date: reportDate, data: reportText, overwrite }) });
      const result = await response.json();
      if (response.status === 409 && result.requiresOverwriteConfirmation) { setPreview(result); setOverwrite(false); setError(result.message); return; }
      if (!response.ok) {
        const skippedMessage = result.skippedUnassigned ? ` ${result.skippedUnassigned} unassigned row(s) were skipped; no report data was saved.` : '';
        throw new Error(`${result.message || 'Unable to import report.'}${skippedMessage}`);
      }
      setNotice(`Saved report. Inserted ${result.inserted}, updated ${result.updated}, duplicates skipped ${result.skipped}, unassigned skipped ${result.skippedUnassigned}, invalid ${result.invalid}.`);
      setReportText(''); setPreview(null); setOverwrite(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to import report.'); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    if (!joinLink) return;
    try { await navigator.clipboard.writeText(joinLink.url); setNotice('Joining link copied.'); }
    catch { setError('Unable to access clipboard. Copy the link from the field.'); }
  }

  async function saveAnnouncement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await requestJson('/api/announcements', {
        method: editingAnnouncementId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingAnnouncementId || undefined, message: announcementMessage }),
      });
      setAnnouncementMessage(''); setEditingAnnouncementId('');
      setNotice(editingAnnouncementId ? 'Announcement updated.' : 'Announcement published to this workspace.');
      setAnnouncements((current) => editingAnnouncementId
        ? current.map((announcement) => announcement.id === editingAnnouncementId ? result.announcement : announcement)
        : [result.announcement, ...current]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save announcement.'); }
    finally { setBusy(false); }
  }

  async function deleteAnnouncement(id: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await requestJson(`/api/announcements?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setAnnouncements((current) => current.filter((announcement) => announcement.id !== id));
      if (editingAnnouncementId === id) { setEditingAnnouncementId(''); setAnnouncementMessage(''); }
      setNotice('Announcement deleted from this workspace.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to delete announcement.'); }
    finally { setBusy(false); }
  }

  async function saveWorkspaceName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await requestJson('/api/workspace/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workspaceNameDraft }),
      });
      setWorkspaceName(result.name);
      setWorkspaceNameDraft(result.name);
      setNotice('Workspace name saved.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update workspace name.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="dashboard-main min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-900 sm:px-6">
      <DashboardNavigation role="Admin" links={[
        { label: 'Overview', href: '/admin' }, { label: 'My Workers', href: '/admin/workers' },
        { label: 'Daily Worker Orders', href: '/admin/daily-orders' }, { label: 'Assigned Users', href: '/admin/assignments' },
        { label: 'Official Reports', href: '/admin/reports' }, { label: 'All Orders', href: '/admin/orders' },
        { label: 'Workspace Settings', href: '/admin/workspace' }, { label: 'Announcements', href: '/admin/announcements' },
        { label: 'Audit Log', href: '/admin/audit' }, { label: 'Payments', href: '/admin/payments' },
        { label: 'Interviews', href: '/admin/interviews' }, { label: 'Account Security', href: '/admin/security' },
      ]} />
      <div className="mx-auto max-w-7xl">
        <header className="dashboard-page-header mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Leadgen Official · Admin Workspace</p><h1 className="mt-2 text-3xl font-bold">{adminViewTitle(view)}</h1><p className="mt-1 text-sm text-slate-600">{name} · private workspace</p></div>
          <div className="dashboard-page-header-actions"><LogoutButton /></div>
        </header>
        {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {!workspaceId && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">No workspace is assigned to this Admin account. Ask the Super Admin to configure it.</p>}
        {view === 'overview' && <section aria-label="Admin overview" className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[[ 'Active Workers', workers.filter((worker) => worker.status === 'active').length, '/admin/workers' ], [ 'Workers awaiting action', workers.filter((worker) => worker.status === 'pending').length, '/admin/workers' ], [ 'Pending orders', orders.filter((order) => order.pendingQuantity > 0).length, '/admin/orders' ], [ 'Active assignments', assignments.filter((assignment) => assignment.status === 'active').length, '/admin/assignments' ]].map(([label, value, href]) => <Link key={String(label)} href={String(href)} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold">{loading ? '…' : value}</p><span className="mt-2 inline-block text-sm font-semibold text-blue-700">Open section →</span></Link>)}
          <div className="sm:col-span-2 xl:col-span-4"><h2 className="mb-2 text-lg font-bold">Quick links</h2><div className="flex flex-wrap gap-2">{[['Daily Worker Orders', '/admin/daily-orders'], ['Official Reports', '/admin/reports'], ['Workspace Settings', '/admin/workspace'], ['Announcements', '/admin/announcements']].map(([label, href]) => <Link key={href} href={href} className="btn btn-secondary">{label}</Link>)}</div></div>
        </section>}
        {view === 'daily-orders' && <DailyOrderOverview workspaceId={workspaceId} />}

        <div className="grid gap-8 xl:grid-cols-2">
          {view === 'workers' && <section id="admin-workers" className="scroll-mt-20">
            <h2 className="mb-3 text-xl font-bold">Worker approvals</h2>
            <form onSubmit={(event) => { event.preventDefault(); setWorkerPage(1); setWorkerQuery(workerSearch.trim()); }} className="mb-3 flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="worker-search">Search workers</label><input id="worker-search" value={workerSearch} onChange={(event) => setWorkerSearch(event.target.value)} placeholder="Search name, username, email" className="min-w-52 flex-1 rounded border border-slate-300 px-3 py-2 text-sm" />
              <label className="sr-only" htmlFor="worker-status">Filter worker status</label><select id="worker-status" value={workerStatus} onChange={(event) => { setWorkerStatus(event.target.value); setWorkerPage(1); }} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option></select>
              <label className="sr-only" htmlFor="worker-from">Registered from</label><input id="worker-from" type="date" aria-label="Registered from" value={workerFrom} onChange={(event) => { setWorkerFrom(event.target.value); setWorkerPage(1); }} className="rounded border border-slate-300 px-2 py-2 text-sm" />
              <label className="sr-only" htmlFor="worker-to">Registered to</label><input id="worker-to" type="date" aria-label="Registered to" value={workerTo} onChange={(event) => { setWorkerTo(event.target.value); setWorkerPage(1); }} className="rounded border border-slate-300 px-2 py-2 text-sm" />
              <button className="btn btn-secondary">Search</button><span className="self-center text-xs text-slate-500">{workerTotal} workers</span>
            </form>
            <div className="overflow-x-auto border border-slate-200 bg-white">
              <table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-3">Worker</th><th className="px-3 py-3">Email</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Action</th></tr></thead><tbody>
                {workers.map((worker) => <tr key={worker.id} className="border-t border-slate-100"><td className="px-3 py-3 font-medium">{worker.name}<span className="block text-xs text-slate-500">@{worker.username}</span></td><td className="px-3 py-3">{worker.email}</td><td className="px-3 py-3">{worker.status}</td><td className="px-3 py-3"><div className="flex gap-2">{worker.status === 'pending' && <Link href="/admin/interviews" className="rounded bg-blue-100 px-2 py-1 text-blue-900">Review interview</Link>}{worker.status === 'inactive' && <button disabled={busy} onClick={() => void updateWorker(worker.id, 'active')} className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">Reactivate</button>}{worker.status === 'blocked' && <button disabled={busy} onClick={() => void updateWorker(worker.id, 'active')} className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">Unblock</button>}{worker.status === 'active' && <button disabled={busy} onClick={() => void updateWorker(worker.id, 'inactive')} className="rounded bg-amber-100 px-2 py-1 text-amber-900">Deactivate</button>}</div></td></tr>)}
                {!loading && workers.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">No workers registered in this workspace.</td></tr>}
              </tbody></table>
            </div>
            <div className="mt-2 flex justify-end gap-2"><button disabled={workerPage <= 1} onClick={() => setWorkerPage((page) => page - 1)} className="btn btn-secondary disabled:opacity-50">Previous</button><span className="px-2 py-2 text-sm">Page {workerPage}</span><button disabled={!workerHasMore} onClick={() => setWorkerPage((page) => page + 1)} className="btn btn-secondary disabled:opacity-50">Next</button></div>
          </section>}

          {view === 'workers' && <section>
            <h2 className="mb-3 text-xl font-bold">Worker joining link</h2>
            <div className="border-t-4 border-blue-600 bg-white p-5 shadow-sm">
              {joinLink ? <><label htmlFor="join-link" className="text-sm font-medium text-slate-700">Your assigned link</label><input id="join-link" readOnly value={joinLink.url} className="mt-2 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm" /><p className="mt-2 text-xs text-slate-500">Status: {joinLink.status} · Created {new Date(joinLink.createdAt).toLocaleString()} · Last used {joinLink.lastUsedAt ? new Date(joinLink.lastUsedAt).toLocaleString() : 'never'}</p><div className="mt-3 flex gap-2"><button onClick={() => void copyLink()} className="btn btn-secondary">Copy link</button></div></> : <><p className="text-sm text-slate-600">No joining link has been assigned to this workspace yet. Contact the Super Admin to issue one.</p><button disabled={busy} onClick={() => void loadData()} className="btn btn-secondary mt-3">Refresh link status</button></>}
            </div>
          </section>}

          {view === 'assignments' && <section id="assign-users" className="scroll-mt-20">
            <h2 className="mb-3 text-xl font-bold">Assign usernames</h2>
            <form onSubmit={assignUsernames} className="space-y-3 border-t-4 border-emerald-600 bg-white p-5 shadow-sm">
              <label className="block text-sm font-medium text-slate-700">Worker<select value={selectedWorker} onChange={(event) => setSelectedWorker(event.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Select active worker</option>{workers.filter((worker) => worker.status === 'active').map((worker) => <option value={worker.id} key={worker.id}>{worker.name} (@{worker.username})</option>)}</select></label>
              <label className="block text-sm font-medium text-slate-700">Usernames, one per line<textarea value={usernames} onChange={(event) => setUsernames(event.target.value)} rows={5} required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm" placeholder="username001&#10;username002" /></label>
              <label className="block text-sm font-medium text-slate-700">Last stop time (optional)<input type="datetime-local" value={lastStopTime} onChange={(event) => setLastStopTime(event.target.value)} className="mt-1 block rounded-md border border-slate-300 px-3 py-2" /></label>
              <button disabled={busy || !selectedWorker} className="btn btn-primary disabled:opacity-60">Assign usernames</button>
            </form>
            {reassignmentConfirmation && <div role="alert" className="mt-3 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-semibold">Confirm reassignment to {workers.find((worker) => worker.id === reassignmentConfirmation.workerId)?.name || 'the selected Worker'}.</p>
              <p className="mt-1">These usernames will move from their current Workers. Previous assignment records remain in history; only the new active assignee can access their reports.</p>
              <ul className="my-2 list-inside list-disc">{reassignmentConfirmation.assignments.map((assignment) => <li key={assignment.username}>{assignment.username} <span className="text-amber-800">(current Worker: {workers.find((worker) => worker.id === assignment.workerId)?.name || assignment.workerId})</span></li>)}</ul>
              <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void confirmReassignment()} className="btn btn-primary">Confirm reassignment</button><button type="button" disabled={busy} onClick={() => setReassignmentConfirmation(null)} className="btn btn-secondary">Cancel</button></div>
            </div>}
            <div className="mt-4 max-h-80 overflow-auto border border-slate-200 bg-white">
              <table className="w-full min-w-[480px] text-left text-sm"><thead className="sticky top-0 bg-slate-100 text-slate-600"><tr><th className="px-3 py-2">Username</th><th className="px-3 py-2">Worker</th><th className="px-3 py-2">Last stop · Dhaka</th><th className="px-3 py-2">Status</th></tr></thead><tbody>
                {assignments.map((assignment) => <tr key={assignment.id} className="border-t border-slate-100"><td className="px-3 py-2 font-medium">{assignment.username}</td><td className="px-3 py-2">{assignment.workerName || assignment.workerId}</td><td className="px-3 py-2">{assignment.lastStopTime ? new Date(assignment.lastStopTime).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }) : 'Not set'}</td><td className="px-3 py-2">{assignment.status}</td></tr>)}
                {!loading && assignments.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No usernames assigned yet.</td></tr>}
              </tbody></table>
            </div>
          </section>}

          {view === 'reports' && <section id="official-reports" className="scroll-mt-20">
            <h2 className="mb-3 text-xl font-bold">Official report import</h2>
            <div className="border-t-4 border-amber-500 bg-white p-5 shadow-sm">
              <label className="block text-sm font-medium text-slate-700">Report date<input type="date" value={reportDate} onChange={(event) => { setReportDate(event.target.value); setPreview(null); setReportHistory(null); }} className="mt-1 block rounded-md border border-slate-300 px-3 py-2" /></label>
              <label className="mt-3 block text-sm font-medium text-slate-700">Paste username and value rows<textarea value={reportText} onChange={(event) => { setReportText(event.target.value); setPreview(null); }} rows={6} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm" placeholder={'username001\t25\nusername002\t40'} /></label>
              <button disabled={busy || !reportText.trim()} onClick={() => void previewReports()} className="btn btn-secondary mt-3">Preview import</button>
              {preview && <div className="mt-4 border-t border-slate-200 pt-4"><p className="text-sm font-semibold">New {preview.summary.new} · updates {preview.summary.updates} · duplicates {preview.summary.duplicates} · invalid {preview.summary.invalid} · unassigned to skip {preview.summary.skippedUnassigned ?? preview.summary.unassigned}</p>
                {preview.rows.length > 0 && <div className="mt-3 max-h-48 overflow-auto border border-slate-200"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Username</th><th className="p-2">Value</th><th className="p-2">Existing</th><th className="p-2">Assignment</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={`${row.line}-${row.username}`} className="border-t"><td className="p-2">{row.username}</td><td className="p-2">{row.reportValue}</td><td className="p-2">{row.existingValue ?? 'new'}</td><td className="p-2">{row.unassigned ? 'unassigned' : 'assigned'}</td></tr>)}</tbody></table></div>}
                {preview.invalid.length > 0 && <p className="mt-2 text-sm text-red-700">Invalid rows: {preview.invalid.map((row) => `#${row.line} ${row.reason}`).join('; ')}</p>}
                {preview.summary.updates > 0 && <label className="mt-3 flex items-start gap-2 text-sm text-amber-900"><input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} className="mt-1" />I confirm the existing values for this date should be corrected.</label>}
                <button disabled={busy || preview.rows.length === 0 || (preview.summary.updates > 0 && !overwrite)} onClick={() => void saveReports()} className="btn btn-primary mt-3 disabled:opacity-60">Save report import</button>
              </div>}
              <div className="mt-4 border-t border-slate-200 pt-3"><button disabled={busy} onClick={() => void loadReportHistory()} className="btn btn-secondary">Load correction history</button>
                {reportHistory && <div className="mt-3 max-h-56 overflow-auto border border-slate-200"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Username</th><th className="p-2">Previous</th><th className="p-2">Corrected</th><th className="p-2">Changed at (Dhaka)</th></tr></thead><tbody>{reportHistory.map((entry) => <tr key={entry.id} className="border-t"><td className="p-2">{entry.username}</td><td className="p-2">{entry.previousValue}</td><td className="p-2">{entry.nextValue}</td><td className="p-2">{new Date(entry.changedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</td></tr>)}{reportHistory.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-slate-500">No corrections recorded for this date.</td></tr>}</tbody></table></div>}
              </div>
            </div>
          </section>}

          {view === 'orders' && <section id="user-orders" className="scroll-mt-20 xl:col-span-2">
            <h2 className="mb-3 text-xl font-bold">User orders</h2>
            <div className="overflow-x-auto border border-slate-200 bg-white"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-3">Worker</th><th className="px-3 py-3">Requested</th><th className="px-3 py-3">Delivered</th><th className="px-3 py-3">Pending</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Fulfill pending</th></tr></thead><tbody>
              {orders.map((order) => <tr key={order.id} className="border-t border-slate-100"><td className="px-3 py-3">{order.workerName || order.workerId}</td><td className="px-3 py-3">{order.requestedQuantity}</td><td className="px-3 py-3">{order.deliveredQuantity}</td><td className="px-3 py-3">{order.pendingQuantity}</td><td className="px-3 py-3">{order.status}</td><td className="px-3 py-3">{order.pendingQuantity > 0 ? <div className="flex gap-2"><input type="number" min="0" max={order.pendingQuantity} value={orderDelivery[order.id] ?? order.pendingQuantity} onChange={(event) => setOrderDelivery((current) => ({ ...current, [order.id]: event.target.value }))} className="w-20 rounded border border-slate-300 px-2 py-1" /><button disabled={busy} onClick={() => void fulfillOrder(order.id, order.deliveredQuantity, order.pendingQuantity)} className="rounded bg-blue-100 px-2 py-1 text-blue-800">Deliver</button></div> : 'Complete'}</td></tr>)}
              {!loading && orders.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No user orders in this workspace.</td></tr>}
            </tbody></table></div>
          </section>}
        </div>
        {view === 'workspace' && <section id="workspace-settings" className="mt-9 scroll-mt-20 border-t border-slate-200 pt-7">
          <h2 className="mb-3 text-xl font-bold">Workspace Settings</h2>
          <form onSubmit={saveWorkspaceName} className="grid gap-3 border-t-4 border-blue-600 bg-white p-5 shadow-sm sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block text-sm font-medium text-slate-700">Workspace name<input value={workspaceNameDraft} onChange={(event) => setWorkspaceNameDraft(event.target.value)} required disabled={!workspaceId || busy} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
            <button disabled={busy || !workspaceId || !workspaceNameDraft.trim() || workspaceNameDraft.trim() === workspaceName} className="btn btn-primary">Save workspace name</button>
          </form>
        </section>}
        {view === 'announcements' && <section id="workspace-announcements" className="mt-9 scroll-mt-20 border-t border-slate-200 pt-7">
          <h2 className="mb-3 text-xl font-bold">Announcements</h2>
          <form onSubmit={saveAnnouncement} className="grid gap-3 border-t-4 border-blue-600 bg-white p-5 shadow-sm">
            <label className="block text-sm font-medium text-slate-700">Announcement<textarea value={announcementMessage} onChange={(event) => setAnnouncementMessage(event.target.value)} maxLength={2000} rows={3} required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Share an update with Workers in this workspace" /></label>
            <div className="flex flex-wrap gap-2"><button disabled={busy || !workspaceId || !announcementMessage.trim()} className="btn btn-primary">{editingAnnouncementId ? 'Save announcement' : 'Publish announcement'}</button>{editingAnnouncementId && <button type="button" disabled={busy} onClick={() => { setEditingAnnouncementId(''); setAnnouncementMessage(''); }} className="btn btn-secondary">Cancel edit</button>}</div>
          </form>
          <div className="mt-3 space-y-3">{announcements.map((announcement) => <article key={announcement.id} className="flex flex-wrap items-start justify-between gap-3 border border-slate-200 bg-white p-4">
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-slate-800">{announcement.message}</p>
            <div className="flex shrink-0 gap-2"><button type="button" disabled={busy} onClick={() => { setEditingAnnouncementId(announcement.id); setAnnouncementMessage(announcement.message); }} className="btn btn-secondary">Edit</button><button type="button" disabled={busy} onClick={() => void deleteAnnouncement(announcement.id)} className="rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">Delete</button></div>
          </article>)}{!loading && announcements.length === 0 && <p className="border border-slate-200 bg-white p-5 text-sm text-slate-500">No announcements for this workspace yet.</p>}</div>
        </section>}
        {view === 'audit' && <section id="workspace-audit" className="mt-9 scroll-mt-20 border-t border-slate-200 pt-7">
          <h2 className="mb-3 text-xl font-bold">Workspace audit log</h2>
          <div className="overflow-x-auto border border-slate-200 bg-white"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-3">Time</th><th className="px-3 py-3">Actor</th><th className="px-3 py-3">Action</th><th className="px-3 py-3">Resource</th></tr></thead><tbody>{auditEntries.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="px-3 py-2">{new Date(entry.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</td><td className="px-3 py-2">{entry.actorRole}</td><td className="px-3 py-2">{entry.action}</td><td className="px-3 py-2">{entry.resourceType}</td></tr>)}{!loading && auditEntries.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No logged actions yet.</td></tr>}</tbody></table></div>
        </section>}
        {view === 'payments' && <AdminFinance workspaceId={workspaceId} />}
        {view === 'interviews' && <InterviewWorkspace mode="admin" workers={workers} />}
        {view === 'security' && <AccountSecurity />}
      </div>
    </main>
  );
}
