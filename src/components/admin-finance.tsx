'use client';

import { useEffect, useEffectEvent, useState } from 'react';

type Worker = { id: string; name: string; username: string; status: string };
type LeadRow = { username: string; officialReportValue: number; workerId: string | null; workerName: string | null; approval: { approvedLeads: number; rejectedLeads: number; adjustmentAmount: number; adjustmentReason: string } | null };
type ReviewForm = { approvedLeads: string; rejectedLeads: string; adjustmentAmount: string; adjustmentReason: string };
type Rate = { id: string; effectiveDate: string; ratePerLead: number; currency: string; updatedAt: string };
type Allocation = { reportDate: string; approvedLeads: number; ratePerLead: number; currency: string; adjustmentAmount: number; adjustmentReason: string; amount: number };
type Payment = { id: string; workerId: string; workerName: string | null; paymentMethod: string; accountSnapshot: string; transactionReference: string; currency: string; grossAmount: number; adjustmentTotal: number; payableAmount: number; paidAmount: number; remainingBalance: number; paymentHistory: { amount: number; transactionReference: string; recordedAt: string }[]; allocations: Allocation[]; status: string; finalizedAt: string; paidAt: string | null };
type Preview = { worker: { id: string; status: string; paymentAccounts: Record<string, string> }; lines: Allocation[]; missing: string[]; alreadyPaid: string[]; grossAmount: number; adjustmentTotal: number; payableAmount: number; currency: string };

export function AdminFinance({ workspaceId }: { workspaceId: string | null }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reportDate, setReportDate] = useState(today);
  const [leadRows, setLeadRows] = useState<LeadRow[]>([]);
  const [reviewValues, setReviewValues] = useState<Record<string, ReviewForm>>({});
  const [rateDate, setRateDate] = useState(today);
  const [rateValue, setRateValue] = useState('');
  const [currency, setCurrency] = useState('BDT');
  const [paymentWorkerId, setPaymentWorkerId] = useState('');
  const [paymentDates, setPaymentDates] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bKash');
  const [transactionReference, setTransactionReference] = useState('');
  const [paymentEntries, setPaymentEntries] = useState<Record<string, { amount: string; reference: string }>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function api(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Request failed.');
    return result;
  }

  function withWorkspace(url: string) { return workspaceId ? `${url}${url.includes('?') ? '&' : '?'}workspaceId=${encodeURIComponent(workspaceId)}` : url; }

  async function loadData() {
    setLoading(true); setError('');
    try {
      const paymentData = await api(withWorkspace('/api/payments?limit=50'));
      setWorkers([]);
      setRates([]);
      if (workspaceId) {
        const [workerData, rateData] = await Promise.all([api(withWorkspace('/api/workers?limit=100')), api(withWorkspace('/api/daily-rates'))]);
        setWorkers(workerData.workers);
        setRates(rateData.rates);
        if (!paymentWorkerId && workerData.workers.length) setPaymentWorkerId(workerData.workers.find((worker: Worker) => worker.status === 'active')?.id || '');
      }
      setPayments(paymentData.payments);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load financial workspace data.'); }
    finally { setLoading(false); }
  }

  const refreshFinanceData = useEffectEvent(() => loadData());
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshFinanceData(); }, [workspaceId]);

  async function loadLeadReviews() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(withWorkspace(`/api/lead-approvals?date=${encodeURIComponent(reportDate)}`));
      setLeadRows(result.rows);
      setReviewValues(Object.fromEntries(result.rows.filter((row: LeadRow) => row.workerId).map((row: LeadRow) => [row.username, {
        approvedLeads: String(row.approval?.approvedLeads ?? 0),
        rejectedLeads: String(row.approval?.rejectedLeads ?? 0),
        adjustmentAmount: String(row.approval?.adjustmentAmount ?? 0),
        adjustmentReason: row.approval?.adjustmentReason ?? '',
      }])));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load report rows.'); }
    finally { setBusy(false); }
  }

  async function saveLeadReviews() {
    const items = leadRows.filter((row) => row.workerId).map((row) => ({ username: row.username, approvedLeads: Number(reviewValues[row.username]?.approvedLeads), rejectedLeads: Number(reviewValues[row.username]?.rejectedLeads), adjustmentAmount: Number(reviewValues[row.username]?.adjustmentAmount), adjustmentReason: reviewValues[row.username]?.adjustmentReason || '' }));
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/api/lead-approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: reportDate, workspaceId, items }) });
      setNotice(`Saved ${result.saved} lead decisions. Official report values remain unchanged.`);
      await loadLeadReviews();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save lead decisions.'); }
    finally { setBusy(false); }
  }

  async function saveRate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api('/api/daily-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: rateDate, ratePerLead: Number(rateValue), currency, workspaceId }) });
      setNotice(`Rate saved from ${rateDate}.`); setRateValue(''); await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save the daily rate.'); }
    finally { setBusy(false); }
  }

  async function previewPayment() {
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try {
      const reportDates = [...new Set(paymentDates.split(/[\s,]+/).map((date) => date.trim()).filter(Boolean))];
      const result = await api('/api/payments/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: paymentWorkerId, reportDates, workspaceId }) });
      setPreview(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to preview payment.'); }
    finally { setBusy(false); }
  }

  async function finalizePayment() {
    if (!preview) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const reportDates = preview.lines.map((line) => line.reportDate);
      const result = await api('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workerId: paymentWorkerId, reportDates, paymentMethod, transactionReference, workspaceId }) });
      setNotice(`Payment ${result.paymentId} cleared for ${result.currency} ${result.payableAmount}.`);
      setPreview(null); setTransactionReference(''); await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to finalize payment.'); }
    finally { setBusy(false); }
  }

  async function changePaymentStatus(payment: Payment, status: 'paid' | 'void', paidAmount?: number) {
    if (status === 'void' && !window.confirm(`Void payment ${payment.id}? Its dates will become eligible for a replacement clearance.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/api/payments/${encodeURIComponent(payment.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, paidAmount, transactionReference: paymentEntries[payment.id]?.reference, workspaceId }) });
      setNotice(`Payment recorded. Remaining balance: ${payment.currency} ${result.remainingBalance}.`); await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update payment.'); }
    finally { setBusy(false); }
  }

  function updateReview(username: string, key: keyof ReviewForm, value: string) {
    setReviewValues((current) => ({ ...current, [username]: { ...current[username], [key]: value } }));
  }

  return (
    <section className="mt-9 border-t border-slate-200 pt-7">
      <h2 className="text-xl font-bold">Lead approvals and payments</h2>
      <p className="mt-1 text-sm text-slate-600">Official report values are kept separate from payable lead approvals and rate calculations.</p>
      {error && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {workspaceId && <div className="mt-5 grid gap-8 xl:grid-cols-2">
        <section>
          <h3 className="mb-3 text-lg font-bold">Review payable leads</h3>
          <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-medium">Report date<input type="date" value={reportDate} onChange={(event) => { setReportDate(event.target.value); setLeadRows([]); }} className="mt-1 block rounded border border-slate-300 px-3 py-2" /></label><button disabled={busy} onClick={() => void loadLeadReviews()} className="btn btn-secondary">Load reports</button></div>
          <div className="mt-3 max-h-[32rem] overflow-auto border border-slate-200 bg-white"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-slate-600"><tr><th className="p-2">Username</th><th className="p-2">Worker</th><th className="p-2">Official value</th><th className="p-2">Approved</th><th className="p-2">Rejected</th><th className="p-2">Adjustment</th></tr></thead><tbody>
            {leadRows.map((row) => <tr key={row.username} className="border-t border-slate-100"><td className="p-2 font-medium">{row.username}</td><td className="p-2">{row.workerName || 'Not assigned'}</td><td className="p-2">{row.officialReportValue}</td>{row.workerId ? <><td className="p-2"><input aria-label={`Approved leads for ${row.username}`} type="number" min="0" max={row.officialReportValue} step="1" value={reviewValues[row.username]?.approvedLeads ?? '0'} onChange={(event) => updateReview(row.username, 'approvedLeads', event.target.value)} className="w-20 rounded border px-2 py-1" /></td><td className="p-2"><input aria-label={`Rejected leads for ${row.username}`} type="number" min="0" max={row.officialReportValue} step="1" value={reviewValues[row.username]?.rejectedLeads ?? '0'} onChange={(event) => updateReview(row.username, 'rejectedLeads', event.target.value)} className="w-20 rounded border px-2 py-1" /></td><td className="p-2"><input aria-label={`Adjustment for ${row.username}`} type="number" step="0.01" value={reviewValues[row.username]?.adjustmentAmount ?? '0'} onChange={(event) => updateReview(row.username, 'adjustmentAmount', event.target.value)} className="w-24 rounded border px-2 py-1" /><input aria-label={`Adjustment reason for ${row.username}`} placeholder="Reason" value={reviewValues[row.username]?.adjustmentReason ?? ''} onChange={(event) => updateReview(row.username, 'adjustmentReason', event.target.value)} className="mt-1 w-40 rounded border px-2 py-1" /></td></> : <td colSpan={3} className="p-2 text-amber-800">No active assignment</td>}</tr>)}
            {leadRows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Select a date and load official reports.</td></tr>}
          </tbody></table></div>
          <button disabled={busy || leadRows.length === 0 || leadRows.every((row) => !row.workerId)} onClick={() => void saveLeadReviews()} className="btn btn-primary mt-3">Save approval decisions</button>
        </section>

        <div className="space-y-8">
          <section>
            <h3 className="mb-3 text-lg font-bold">Date-based daily rates</h3>
            <form onSubmit={saveRate} className="grid gap-3 border-t-4 border-blue-600 bg-white p-4 sm:grid-cols-3">
              <label className="text-sm font-medium">Effective from<input required type="date" value={rateDate} onChange={(event) => setRateDate(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-2" /></label>
              <label className="text-sm font-medium">Rate per approved lead<input required type="number" min="0" step="0.01" value={rateValue} onChange={(event) => setRateValue(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-2" /></label>
              <label className="text-sm font-medium">Currency<input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} className="mt-1 w-full rounded border border-slate-300 px-2 py-2" /></label>
              <button disabled={busy} className="btn btn-primary sm:col-span-3">Save rate</button>
            </form>
            <div className="mt-2 max-h-36 overflow-auto border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="bg-slate-100"><tr><th className="p-2">Effective date</th><th className="p-2">Rate / lead</th><th className="p-2">Currency</th></tr></thead><tbody>{rates.map((rate) => <tr key={rate.id} className="border-t"><td className="p-2">{rate.effectiveDate}</td><td className="p-2">{rate.ratePerLead}</td><td className="p-2">{rate.currency}</td></tr>)}{!loading && rates.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-slate-500">No rate configured.</td></tr>}</tbody></table></div>
          </section>

          <section>
            <h3 className="mb-3 text-lg font-bold">Payment clearance</h3>
            <div className="space-y-3 border-t-4 border-emerald-600 bg-white p-4">
              <label className="block text-sm font-medium">Worker<select required value={paymentWorkerId} onChange={(event) => { setPaymentWorkerId(event.target.value); setPreview(null); }} className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2"><option value="">Select worker</option>{workers.filter((worker) => worker.status === 'active').map((worker) => <option key={worker.id} value={worker.id}>{worker.name} (@{worker.username})</option>)}</select></label>
              <label className="block text-sm font-medium">Unpaid report dates, one per line<textarea required rows={3} value={paymentDates} onChange={(event) => { setPaymentDates(event.target.value); setPreview(null); }} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm" placeholder={`${today}`} /></label>
              <label className="block text-sm font-medium">Payment channel<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2"><option>bKash</option><option>Nagad</option><option>Rocket</option><option>Bank Transfer</option><option>Cash</option></select></label>
              <label className="block text-sm font-medium">Transaction reference (optional)<input maxLength={100} value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
              <button disabled={busy || !paymentWorkerId} onClick={() => void previewPayment()} className="btn btn-secondary">Preview clearance</button>
              {preview && <div className="border-t border-slate-200 pt-3"><p className="text-sm">Account: <strong>{paymentMethod === 'Cash' ? 'Cash recorded' : preview.worker.paymentAccounts[paymentMethod] || 'No account saved'}</strong></p><div className="mt-2 overflow-auto"><table className="w-full min-w-[440px] text-left text-xs"><thead className="bg-slate-100"><tr><th className="p-2">Date</th><th className="p-2">Approved leads</th><th className="p-2">Rate</th><th className="p-2">Adjustment</th><th className="p-2">Amount</th></tr></thead><tbody>{preview.lines.map((line) => <tr key={line.reportDate} className="border-t"><td className="p-2">{line.reportDate}</td><td className="p-2">{line.approvedLeads}</td><td className="p-2">{line.ratePerLead} {line.currency}</td><td className="p-2">{line.adjustmentAmount}</td><td className="p-2">{line.amount}</td></tr>)}</tbody></table></div><p className="mt-2 text-right font-bold">Payable {preview.currency} {preview.payableAmount}</p>{(preview.missing.length > 0 || preview.alreadyPaid.length > 0) && <p className="mt-2 text-sm text-red-700">Needs approval: {preview.missing.join(', ') || 'none'} · already allocated: {preview.alreadyPaid.join(', ') || 'none'}</p>}<button disabled={busy || !preview.lines.length || preview.missing.length > 0 || preview.alreadyPaid.length > 0 || (paymentMethod !== 'Cash' && !preview.worker.paymentAccounts[paymentMethod])} onClick={() => void finalizePayment()} className="btn btn-primary mt-3 w-full">Finalize payment</button></div>}
            </div>
          </section>
        </div>
      </div>}

      <section className="mt-8">
        <h3 className="mb-3 text-lg font-bold">{workspaceId ? 'Workspace payment history' : 'Global payment history'}</h3>
        <div className="overflow-x-auto border border-slate-200 bg-white"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-3">Worker</th><th className="px-3 py-3">Dates</th><th className="px-3 py-3">Channel / account</th><th className="px-3 py-3">Payable</th><th className="px-3 py-3">Paid / remaining</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Actions</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className="border-t"><td className="px-3 py-2">{payment.workerName || payment.workerId}</td><td className="px-3 py-2">{payment.allocations.map((allocation) => allocation.reportDate).join(', ')}</td><td className="px-3 py-2">{payment.paymentMethod} · {payment.accountSnapshot}<span className="block text-xs text-slate-500">{payment.paymentHistory.map((record, index) => <span key={`${payment.id}-${index}`} className="block">{record.transactionReference || "Payment recorded"}: {payment.currency} {record.amount}</span>)}</span></td><td className="px-3 py-2">{payment.currency} {payment.payableAmount}</td><td className="px-3 py-2">{payment.currency} {payment.paidAmount} / {payment.currency} {payment.remainingBalance}</td><td className="px-3 py-2">{payment.status}</td><td className="px-3 py-2">{['cleared', 'partially_paid'].includes(payment.status) && <div className="grid min-w-48 gap-2"><input aria-label={`Payment amount for ${payment.id}`} type="number" min="0.01" max={payment.remainingBalance} step="0.01" placeholder={`Up to ${payment.remainingBalance}`} value={paymentEntries[payment.id]?.amount || ''} onChange={(event) => setPaymentEntries((current) => ({ ...current, [payment.id]: { amount: event.target.value, reference: current[payment.id]?.reference || '' } }))} className="rounded border px-2 py-1" /><input aria-label={`Transaction reference for ${payment.id}`} maxLength={100} placeholder="Transaction reference" value={paymentEntries[payment.id]?.reference || ''} onChange={(event) => setPaymentEntries((current) => ({ ...current, [payment.id]: { amount: current[payment.id]?.amount || '', reference: event.target.value } }))} className="rounded border px-2 py-1" /><button disabled={busy} onClick={() => void changePaymentStatus(payment, 'paid', Number(paymentEntries[payment.id]?.amount || payment.remainingBalance))} className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">Record payment</button>{payment.paidAmount === 0 && <button disabled={busy} onClick={() => void changePaymentStatus(payment, 'void')} className="rounded bg-red-100 px-2 py-1 text-red-800">Void clearance</button>}</div>}</td></tr>)}{payments.length === 0 && <tr><td colSpan={7} className="px-3 py-7 text-center text-slate-500">No payment records.</td></tr>}</tbody></table></div>
      </section>
    </section>
  );
}
