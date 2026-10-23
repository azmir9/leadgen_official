'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AccountSecurity } from '@/components/account-security';
import { InterviewWorkspace } from '@/components/interview-workspace';
import { LogoutButton } from '@/components/logout-button';
import { DashboardNavigation } from '@/components/dashboard-navigation';
import { formatWorkerReportValue, startWorkerReportPolling, WORKER_REPORT_REFRESH_INTERVAL_MS } from '@/lib/worker-report-refresh';

type Assignment = { id: string; username: string; status: string; lastStopTime: string | null; assignmentDate: string };
type Order = { id: string; requestedQuantity: number; deliveredQuantity: number; pendingQuantity: number; status: string; requestDate: string };
type Report = { username: string; reportValue: number | null };
type WorkspaceAnnouncement = { id: string; message: string; createdAt: string; updatedAt: string };
type WorkerPayment = { id: string; paymentMethod: string; accountSnapshot: string; transactionReference: string; currency: string; payableAmount: number; paidAmount: number; remainingBalance: number; paymentHistory: { amount: number; transactionReference: string; recordedAt: string }[]; allocations: { reportDate: string; approvedLeads: number; ratePerLead: number; adjustmentAmount: number; amount: number }[]; status: string; finalizedAt: string; paidAt: string | null };
type Profile = { name: string; username: string; email: string; phone: string; whatsapp: string; facebook: string; telegram: string; paymentAccounts: Record<string, string> };
type WorkerView = 'overview' | 'reports' | 'assignments' | 'orders' | 'payments' | 'profile' | 'announcements' | 'interviews' | 'security';
const workerViewTitle = (view: WorkerView) => ({ overview: 'Overview', reports: 'My Report History', assignments: 'Assigned Users', orders: 'My Orders', payments: 'My Payments', profile: 'My Profile', announcements: 'Announcements', interviews: 'Interviews', security: 'Account Security' })[view];

export function WorkerWorkspace({ name, status, workspaceId, companyName, ownerName, announcement, logoUrl, view = 'overview' }: { name: string; status: string; workspaceId: string | null; companyName: string; ownerName: string; announcement: string; logoUrl: string; view?: WorkerView }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [workspaceAnnouncements, setWorkspaceAnnouncements] = useState<WorkspaceAnnouncement[]>([]);
  const [reportLoading, setReportLoading] = useState(true);
  const [payments, setPayments] = useState<WorkerPayment[]>([]);
  const [profile, setProfile] = useState<Profile>({ name, username: '', email: '', phone: '', whatsapp: '', facebook: '', telegram: '', paymentAccounts: {} });
  const [reportDate, setReportDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()));
  const [quantity, setQuantity] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const reportDateRef = useRef(reportDate);
  const reportRefreshRef = useRef<() => void>(() => undefined);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [assignmentResponse, orderResponse, profileResponse, paymentResponse] = await Promise.all([
        fetch('/api/assignments'),
        fetch('/api/orders'),
        fetch('/api/profile'),
        fetch('/api/payments?limit=100'),
      ]);
      const [assignmentData, orderData, profileData, paymentData] = await Promise.all([
        assignmentResponse.json(), orderResponse.json(), profileResponse.json(), paymentResponse.json(),
      ]);
      if (!assignmentResponse.ok || !orderResponse.ok || !profileResponse.ok || !paymentResponse.ok) {
        throw new Error(assignmentData.message || orderData.message || profileData.message || paymentData.message || 'Unable to load your workspace data.');
      }
      setAssignments(assignmentData.assignments);
      setOrders(orderData.orders);
      setProfile(profileData.profile);
      setPayments(paymentData.payments);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load your workspace data.');
    } finally {
      setLoading(false);
    }
  }

  const refreshWorkspaceData = useEffectEvent(() => loadData());

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshWorkspaceData(); }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void fetch('/api/announcements')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Unable to load workspace announcements.');
        if (active) setWorkspaceAnnouncements(result.announcements);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to load workspace announcements.');
      });
    return () => { active = false; };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;

    const polling = startWorkerReportPolling(async (signal, isActive) => {
      const requestedDate = reportDateRef.current;
      try {
        const response = await fetch(`/api/reports?date=${encodeURIComponent(requestedDate)}`, { signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Unable to load your reports.');
        if (isActive() && requestedDate === reportDateRef.current) {
          setReports(result.reports);
          setError('');
        }
      } catch (caught) {
        if (!signal.aborted && isActive()) setError(caught instanceof Error ? caught.message : 'Unable to load your reports.');
      } finally {
        if (isActive() && requestedDate === reportDateRef.current) setReportLoading(false);
      }
    }, { documentTarget: document, scheduler: window, intervalMs: WORKER_REPORT_REFRESH_INTERVAL_MS });

    reportRefreshRef.current = polling.refresh;
    return () => {
      polling.stop();
      if (reportRefreshRef.current === polling.refresh) reportRefreshRef.current = () => undefined;
    };
  }, [workspaceId]);

  async function requestUsers(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: Number(quantity) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to submit order.');
      setNotice('Order request submitted.');
      setQuantity('');
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to submit order.');
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice(''); setError('');
    try {
      const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to update your profile.');
      setProfile(result.profile);
      setNotice('Profile updated.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update your profile.'); }
    finally { setSaving(false); }
  }

  const reportTotal = reports.reduce((sum, report) => sum + (report.reportValue ?? 0), 0);
  const activeAssignments = assignments.filter((assignment) => assignment.status === 'active');

  return (
    <main className="dashboard-main min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-900 sm:px-6">
      <DashboardNavigation role="Worker" links={[
        { label: 'Overview', href: '/worker' }, { label: 'My Report History', href: '/worker/reports' },
        { label: 'Assigned Users', href: '/worker/assignments' }, { label: 'My Orders', href: '/worker/orders' },
        { label: 'My Payments', href: '/worker/payments' }, { label: 'Announcements', href: '/worker/announcements' },
        { label: 'My Profile', href: '/worker/profile' }, { label: 'Interviews', href: '/worker/interviews' },
        { label: 'Account Security', href: '/worker/security' },
      ]} />
      <div className="mx-auto max-w-6xl">
        <header className="dashboard-page-header mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <div className="flex items-center gap-3">{logoUrl && <Image src={logoUrl} alt={`${companyName} logo`} width={36} height={36} unoptimized className="h-9 w-9 rounded object-contain" />}<p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">{companyName} · Worker</p></div>
            <h1 className="mt-2 text-3xl font-bold">{workerViewTitle(view)}</h1>
            <p className="mt-1 text-sm text-slate-600">{name} · {status} · Company owner: {ownerName}</p>
          </div>
          <div className="dashboard-page-header-actions">
            <LogoutButton />
          </div>
        </header>
        {view === 'announcements' && <section aria-label="Announcements" className="mb-5 grid gap-3">{announcement && <p className="border-l-4 border-blue-600 bg-blue-50 p-4 text-sm text-blue-900"><span className="mb-1 block text-xs font-bold uppercase tracking-wide">Company announcement</span>{announcement}</p>}{workspaceAnnouncements.map((item) => <p key={item.id} className="border-l-4 border-emerald-600 bg-emerald-50 p-4 text-sm text-emerald-950"><span className="mb-1 block text-xs font-bold uppercase tracking-wide">Workspace announcement</span>{item.message}</p>)}{!announcement && workspaceAnnouncements.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No announcements are available.</p>}</section>}

        {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {!workspaceId && <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">Your account is not assigned to a workspace. Contact the company administrator.</p>}

        {view === 'overview' && <section aria-label="Worker overview" className="mb-7 grid gap-3 sm:grid-cols-3">
          <div className="border-l-4 border-blue-600 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Active usernames</p><p className="mt-2 text-3xl font-bold">{loading ? '…' : activeAssignments.length}</p></div>
          <div className="border-l-4 border-emerald-600 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Report total · {reportDate}</p><p className="mt-2 text-3xl font-bold">{loading ? '…' : reportTotal}</p></div>
          <div className="border-l-4 border-amber-500 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Pending username orders</p><p className="mt-2 text-3xl font-bold">{loading ? '…' : orders.filter((order) => order.pendingQuantity > 0).length}</p></div>
          <div className="sm:col-span-3"><h2 className="mb-2 text-lg font-bold">Quick links</h2><div className="flex flex-wrap gap-2">{[['My Report History', '/worker/reports'], ['Assigned Users', '/worker/assignments'], ['My Orders', '/worker/orders'], ['My Payments', '/worker/payments']].map(([label, href]) => <Link key={href} href={href} className="btn btn-secondary">{label}</Link>)}</div></div>
        </section>}

        {(view === 'reports' || view === 'assignments' || view === 'orders') && <section className="grid min-w-0 gap-8 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            {view === 'reports' && <>
            <div id="my-report-history" className="mb-3 flex flex-wrap items-center justify-between gap-3 scroll-mt-4">
              <div>
                <h2 className="text-xl font-bold">My Report History</h2>
                <p className="mt-1 text-sm text-slate-600">Daily report values for your currently active assigned usernames.</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">Report date
                <input type="date" value={reportDate} onChange={(event) => {
                  reportDateRef.current = event.target.value;
                  setReportDate(event.target.value);
                  setReports([]);
                  setReportLoading(true);
                  reportRefreshRef.current();
                }} className="rounded-md border border-slate-300 bg-white px-3 py-2" />
              </label>
            </div>
            <div className="overflow-x-auto border border-slate-200 bg-white">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600"><tr><th className="px-4 py-3">Assigned username</th><th className="px-4 py-3">Report value</th></tr></thead>
                <tbody>
                  {workspaceId && reports.map((report) => <tr key={report.username} className="border-t border-slate-100"><td className="px-4 py-3 font-medium">{report.username}</td><td className="px-4 py-3">{formatWorkerReportValue(report.reportValue)}</td></tr>)}
                  {workspaceId && reportLoading && reports.length === 0 && <tr><td colSpan={2} className="px-4 py-8 text-center text-slate-500">Loading reports…</td></tr>}
                  {workspaceId && !reportLoading && !error && reports.length === 0 && <tr><td colSpan={2} className="px-4 py-8 text-center text-slate-500">No active usernames assigned for report history.</td></tr>}
                </tbody>
              </table>
            </div>
            </>}

            {view === 'assignments' && <>
            <h2 id="assigned-usernames" className="mb-3 mt-8 scroll-mt-20 text-xl font-bold">My assigned usernames</h2>
            <div className="overflow-x-auto border border-slate-200 bg-white">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-slate-100 text-slate-600"><tr><th className="px-4 py-3">Username</th><th className="px-4 py-3">Assigned</th><th className="px-4 py-3">Last stop time</th><th className="px-4 py-3">Status</th></tr></thead>
                <tbody>
                  {assignments.map((assignment) => <tr key={assignment.id} className="border-t border-slate-100"><td className="px-4 py-3 font-medium">{assignment.username}</td><td className="px-4 py-3">{new Date(assignment.assignmentDate).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' })}</td><td className="px-4 py-3">{assignment.lastStopTime ? new Date(assignment.lastStopTime).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }) : 'Not set'}</td><td className="px-4 py-3">{assignment.status}</td></tr>)}
                  {!loading && assignments.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No assignments yet.</td></tr>}
                </tbody>
              </table>
            </div>
            </>}
          </div>

          {view === 'orders' && <aside id="order-users" className="scroll-mt-20">
            <div className="border-t-4 border-blue-600 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Order usernames</h2>
              <form onSubmit={requestUsers} className="mt-4 space-y-3">
                <label htmlFor="quantity" className="block text-sm font-medium text-slate-700">Quantity requested</label>
                <input id="quantity" type="number" min="1" max="10000" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" />
                <button disabled={saving || !workspaceId} className="btn btn-primary w-full disabled:opacity-60">{saving ? 'Submitting…' : 'Submit request'}</button>
              </form>
            </div>
            <h2 className="mb-3 mt-8 text-xl font-bold">My order history</h2>
            <div className="space-y-2">
              {orders.map((order) => <article key={order.id} className="border border-slate-200 bg-white p-4 text-sm"><div className="flex justify-between gap-2 font-semibold"><span>Requested {order.requestedQuantity}</span><span>{order.status}</span></div><p className="mt-2 text-slate-600">Delivered {order.deliveredQuantity} · Pending {order.pendingQuantity}</p><p className="mt-1 text-xs text-slate-500">{new Date(order.requestDate).toLocaleString()}</p></article>)}
              {!loading && orders.length === 0 && <p className="border border-slate-200 bg-white p-5 text-sm text-slate-500">No orders yet.</p>}
            </div>
          </aside>}
        </section>}
        {view === 'payments' && <section id="payments" className="mt-9 scroll-mt-20 border-t border-slate-200 pt-7">
          <h2 className="mb-3 text-xl font-bold">My payments</h2>
          <div className="overflow-x-auto border border-slate-200 bg-white"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-3">Dates</th><th className="px-3 py-3">Approved leads</th><th className="px-3 py-3">Channel</th><th className="px-3 py-3">Amount</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Finalized</th></tr></thead><tbody>
            {payments.map((payment) => <tr key={payment.id} className="border-t border-slate-100"><td className="px-3 py-2">{payment.allocations.map((allocation) => allocation.reportDate).join(', ')}</td><td className="px-3 py-2">{payment.allocations.reduce((sum, allocation) => sum + allocation.approvedLeads, 0)}</td><td className="px-3 py-2">{payment.paymentMethod} · {payment.accountSnapshot}<span className="block text-xs text-slate-500">{payment.paymentHistory.map((record, index) => <span key={`${payment.id}-${index}`} className="block">{payment.currency} {record.amount}{record.transactionReference ? ` · ${record.transactionReference}` : ""} · {new Date(record.recordedAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}</span>)}</span></td><td className="px-3 py-2">{payment.currency} {payment.payableAmount}<span className="block text-xs text-slate-500">Paid {payment.currency} {payment.paidAmount}; remaining {payment.currency} {payment.remainingBalance}</span></td><td className="px-3 py-2">{payment.status}</td><td className="px-3 py-2">{new Date(payment.finalizedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</td></tr>)}
            {!loading && payments.length === 0 && <tr><td colSpan={7} className="px-3 py-7 text-center text-slate-500">No payment history yet.</td></tr>}
          </tbody></table></div>
        </section>}

        {view === 'profile' && <section id="profile" className="mt-9 border-t border-slate-200 pt-7">
          <h2 className="text-xl font-bold">My profile</h2>
          <form onSubmit={saveProfile} className="mt-3 grid gap-3 border-t-4 border-blue-600 bg-white p-5 shadow-sm sm:grid-cols-2">
            <label className="block text-sm font-medium">Full name<input required maxLength={100} value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
            <label className="block text-sm font-medium">Username<input readOnly value={profile.username} className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-slate-500" /></label>
            <label className="block text-sm font-medium">Verified email<input readOnly value={profile.email} className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-slate-500" /></label>
            {([['phone', 'Phone'], ['whatsapp', 'WhatsApp'], ['facebook', 'Facebook profile'], ['telegram', 'Telegram']] as const).map(([key, label]) => <label key={key} className="block text-sm font-medium">{label}<input maxLength={200} value={profile[key]} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>)}
            {(['bKash', 'Nagad', 'Rocket', 'Bank Transfer'] as const).map((provider) => <label key={provider} className="block text-sm font-medium">{provider} account details<input maxLength={100} value={profile.paymentAccounts[provider] || ''} onChange={(event) => setProfile({ ...profile, paymentAccounts: { ...profile.paymentAccounts, [provider]: event.target.value } })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>)}
            <button disabled={saving} className="btn btn-primary sm:col-span-2">Save profile</button>
          </form>
        </section>}
        {view === 'interviews' && <InterviewWorkspace mode="worker" />}
        {view === 'security' && <AccountSecurity />}
      </div>
    </main>
  );
}
