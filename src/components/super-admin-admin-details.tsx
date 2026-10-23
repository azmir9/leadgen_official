'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DashboardNavigation } from '@/components/dashboard-navigation';

type Page<T> = { items: T[]; total: number; page: number; limit: number; hasMore: boolean };
type Details = {
  admin: { id: string; name: string; username: string; email: string; status: string; createdAt?: string; updatedAt?: string };
  workspace: { id: string; name: string; description: string; isActive: boolean; createdAt?: string; updatedAt?: string } | null;
  date: string;
  workers: Page<{ id: string; name: string; username: string; email: string; phone: string; status: string; createdAt?: string }>;
  orders: Page<{ id: string; workerName: string | null; requestedQuantity: number; deliveredQuantity: number; pendingQuantity: number; status: string; requestDate?: string }>;
  assignments: Page<{ id: string; workerName: string | null; username: string; status: string; lastStopTime?: string | null; assignmentDate?: string }>;
  reports: Page<{ username: string; workerName: string | null; reportValue: number | null; date: string }>;
  rates: Page<{ id: string; effectiveDate: string; ratePerLead: number; currency: string; setBy: string }>;
  clearances: Page<{ id: string; workerName: string | null; reportDate: string; username: string; officialReportValue: number; approvedLeads: number; rejectedLeads: number; adjustmentAmount: number; reviewedAt?: string }>;
  allocations: Page<{ id: string; workerName: string | null; reportDate: string; paymentId: string; status: string; createdAt?: string }>;
  payments: Page<{ id: string; workerName: string | null; paymentMethod: string; currency: string; payableAmount: number; status: string; paidAt?: string | null; finalizedAt?: string }>;
  interviews: Page<{ id: string; workerName: string | null; service: string; status: string; submittedAt?: string }>;
  announcements: { global: string; workspace: { id: string; message: string; createdAt: string; updatedAt: string }[] };
};

const sectionIds: Record<string, string> = {
  'My Workers': 'workers',
  'My Order Cards / Username Orders': 'orders',
  Assignments: 'assignments',
  'Official Reports': 'reports',
  'Daily Rates': 'rates',
  'Payment Clearance': 'clearances',
  'Payment Allocations': 'allocations',
  'Payment History': 'payments',
  Interviews: 'interviews',
};

function Records<T>({ title, data, render }: { title: string; data: Page<T> | null; render: (item: T) => React.ReactNode }) {
  return <section id={sectionIds[title]} className="scroll-mt-5 border-t border-slate-200 pt-6">
    <h2 className="text-xl font-bold">{title}</h2>
    {!data ? <p className="mt-3 text-sm text-slate-500">Loading…</p> : data.items.length === 0 ? <p className="mt-3 border bg-white p-4 text-sm text-slate-500">No records found.</p> : <>
      <p className="mt-1 text-xs text-slate-500">{data.total} total · page {data.page}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">{data.items.map((item, index) => <article key={index} className="min-w-0 border border-slate-200 bg-white p-4 text-sm">{render(item)}</article>)}</div>
    </>}
  </section>;
}

export function SuperAdminAdminDetails({ adminId }: { adminId: string }) {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()));
  const [page, setPage] = useState(1);
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/super-admin/admins/${encodeURIComponent(adminId)}/details?date=${encodeURIComponent(date)}&page=${page}&limit=50`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'Unable to load Admin details.');
        return body as Details;
      })
      .then((body) => { if (active) setDetails(body); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Unable to load Admin details.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [adminId, date, page]);

  return <main className="dashboard-main min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-900 sm:px-6"><DashboardNavigation role="Super Admin" links={[
    { label: 'Overview', href: '/super-admin' }, { label: 'My Workers', href: '/super-admin/my-workers' },
    { label: 'Global Admin Overview', href: '/super-admin/admin-overview' }, { label: 'Daily Worker Orders', href: '/super-admin/daily-orders' },
    { label: 'Admin Management', href: '/super-admin/admin-management' }, { label: 'Admin History', href: '/super-admin/admin-history' },
    { label: 'Workspace Operations', href: '/super-admin/workspace-operations' }, { label: 'Official Reports', href: '/super-admin/reports' },
    { label: 'Payments', href: '/super-admin/payments' }, { label: 'Interviews', href: '/super-admin/interviews' },
    { label: 'Global Announcements', href: '/super-admin/announcements' }, { label: 'Global Branding', href: '/super-admin/branding' },
    { label: 'Website CMS', href: '/super-admin/cms' }, { label: 'Global Audit Log', href: '/super-admin/audit' },
    { label: 'Account Security', href: '/super-admin/security' },
  ]} /><div className="mx-auto max-w-7xl">
      <header id="admin-overview" className="mb-6 border-b border-slate-200 pb-5"><p className="text-xs font-bold uppercase tracking-wider text-blue-700">Super Admin · Admin details</p><h1 className="mt-2 text-3xl font-bold">{details?.admin.name || (loading ? 'Loading Admin…' : 'Admin details')}</h1><Link href="/super-admin/admin-management" className="mt-2 inline-block text-sm text-blue-700 underline">Back to Admin Management</Link></header>
      {error && <p role="alert" className="mb-4 border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {details && <>
        <section className="grid gap-3 sm:grid-cols-2"><article className="border-l-4 border-blue-600 bg-white p-4"><h2 className="font-bold">Admin Information</h2><p className="mt-2">{details.admin.name} · @{details.admin.username}</p><p className="text-sm text-slate-600">{details.admin.email} · {details.admin.status}</p><p className="mt-1 text-xs text-slate-500">Created {details.admin.createdAt ? new Date(details.admin.createdAt).toLocaleString() : 'unknown'}</p></article><article className="border-l-4 border-emerald-600 bg-white p-4"><h2 className="font-bold">Workspace</h2>{details.workspace ? <><p className="mt-2">{details.workspace.name} · {details.workspace.isActive ? 'Active' : 'Inactive'}</p><p className="text-sm text-slate-600">{details.workspace.description || 'No description'}</p></> : <p className="mt-2 text-sm text-amber-700">No Workspace is configured.</p>}</article></section>
        <div className="my-6 flex flex-wrap items-center gap-3 rounded border bg-white p-4"><label htmlFor="detail-date" className="text-sm font-semibold">Official report date</label><input id="detail-date" type="date" value={date} onChange={(event) => { setDate(event.target.value); setPage(1); setDetails(null); setLoading(true); setError(''); }} className="rounded border border-slate-300 px-3 py-2" /><span className="text-xs text-slate-500">Values are scoped to this Workspace. Zero is shown as zero.</span></div>
        <Records title="My Workers" data={details.workers} render={(worker) => <><p className="font-semibold">{worker.name} · @{worker.username}</p><p className="text-slate-600">{worker.email} · {worker.status}</p><p className="text-xs text-slate-500">{worker.phone || 'No phone'}</p></>} />
        <Records title="My Order Cards / Username Orders" data={details.orders} render={(item) => <><p className="font-semibold">{item.workerName || 'Worker unavailable'}</p><p>Status: {item.status} · Requested {item.requestedQuantity} · Delivered {item.deliveredQuantity} · Pending {item.pendingQuantity}</p><p className="text-xs text-slate-500">{item.requestDate ? new Date(item.requestDate).toLocaleString() : ''}</p></>} />
        <Records title="Assignments" data={details.assignments} render={(item) => <><p className="font-semibold">{item.username}</p><p>{item.workerName || 'Worker unavailable'} · {item.status}</p><p className="text-xs text-slate-500">Last stop: {item.lastStopTime ? new Date(item.lastStopTime).toLocaleString() : '—'} · Assigned: {item.assignmentDate ? new Date(item.assignmentDate).toLocaleString() : '—'}</p></>} />
        <Records title="Official Reports" data={details.reports} render={(item) => <><p className="font-semibold">{item.username}</p><p>Worker: {item.workerName || 'Worker unavailable'}</p><p>{item.reportValue === null ? 'Not received' : item.reportValue} · {item.date}</p></>} />
        <Records title="Daily Rates" data={details.rates} render={(item) => <><p className="font-semibold">{item.effectiveDate}</p><p>{item.ratePerLead} {item.currency} per lead</p></>} />
        <Records title="Payment Clearance" data={details.clearances} render={(item) => <><p className="font-semibold">{item.username} · {item.workerName || 'Worker unavailable'}</p><p>{item.reportDate} · Official {item.officialReportValue} · Approved {item.approvedLeads} · Rejected {item.rejectedLeads}</p><p>Adjustment: {item.adjustmentAmount}</p></>} />
        <Records title="Payment Allocations" data={details.allocations} render={(item) => <><p className="font-semibold">{item.workerName || 'Worker unavailable'} · {item.status}</p><p>{item.reportDate} · Payment {item.paymentId}</p></>} />
        <Records title="Payment History" data={details.payments} render={(item) => <><p className="font-semibold">{item.workerName || 'Worker unavailable'} · {item.status}</p><p>{item.payableAmount} {item.currency} · {item.paymentMethod}</p><p className="text-xs text-slate-500">{item.finalizedAt ? new Date(item.finalizedAt).toLocaleString() : ''}</p></>} />
        <Records title="Interviews" data={details.interviews} render={(item) => <><p className="font-semibold">{item.workerName || 'Worker unavailable'} · {item.service}</p><p>Status: {item.status}</p><p className="text-xs text-slate-500">Submitted: {item.submittedAt ? new Date(item.submittedAt).toLocaleString() : '—'}</p></>} />
        <section id="announcements" className="scroll-mt-5 border-t border-slate-200 pt-6"><h2 className="text-xl font-bold">Announcements</h2><article className="mt-3 border bg-white p-4"><h3 className="font-semibold">Global company announcement</h3><p className="mt-1 text-sm">{details.announcements.global || 'No global announcement.'}</p></article><div className="mt-3 grid gap-3 md:grid-cols-2">{details.announcements.workspace.map((item) => <article key={item.id} className="border bg-white p-4"><p className="whitespace-pre-wrap text-sm">{item.message}</p><p className="mt-2 text-xs text-slate-500">Created {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</p></article>)}</div>{details.announcements.workspace.length === 0 && <p className="mt-3 text-sm text-slate-500">No Workspace announcements.</p>}</section>
        <div className="mt-6 flex items-center justify-end gap-3"><button className="btn btn-secondary disabled:opacity-50" disabled={page <= 1 || loading} onClick={() => { setPage((current) => current - 1); setDetails(null); setLoading(true); }}>Previous records</button><span className="text-sm">Page {page}</span><button className="btn btn-secondary disabled:opacity-50" disabled={loading || ![details.workers, details.orders, details.assignments, details.reports, details.rates, details.clearances, details.allocations, details.payments, details.interviews].some((items) => items.hasMore)} onClick={() => { setPage((current) => current + 1); setDetails(null); setLoading(true); }}>Next records</button></div>
      </>}
      {loading && !details && <p className="border bg-white p-5 text-sm text-slate-600">Loading scoped Workspace records…</p>}
    </div>
  </main>;
}
