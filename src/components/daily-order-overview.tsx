'use client';

import { Fragment, useEffect, useState } from 'react';

type DailyWorker = {
  id: string; name: string; username: string; status: string; orderStatus: 'ordered' | 'no-order';
  ordered: number; fulfilled: number; pending: number;
  orders: { id: string; requestedQuantity: number; deliveredQuantity: number; pendingQuantity: number; status: string; requestDate: string }[];
};
type Overview = {
  date: string; workspaceId: string; eligibleWorkers: number; orderedWorkers: number; workersWithoutOrders: number;
  totalOrdered: number; totalFulfilled: number; totalPending: number; workers: DailyWorker[];
};

const todayInDhaka = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

export function DailyOrderOverview({ workspaceId, title = 'Daily Worker Orders' }: { workspaceId: string | null; title?: string }) {
  const [date, setDate] = useState(todayInDhaka);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [expandedWorker, setExpandedWorker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workspaceId || !date) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      fetch(`/api/orders/daily-overview?date=${encodeURIComponent(date)}&workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.message || 'Unable to load daily orders.');
          setOverview(result);
        })
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load daily orders.');
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [workspaceId, date]);

  const visibleOverview = overview?.workspaceId === workspaceId && overview.date === date ? overview : null;
  const cards = visibleOverview ? [
    ['Eligible active Workers', visibleOverview.eligibleWorkers], ['Ordered today', visibleOverview.orderedWorkers],
    ['No order today', visibleOverview.workersWithoutOrders], ['Quantity ordered', visibleOverview.totalOrdered],
    ['Quantity fulfilled', visibleOverview.totalFulfilled], ['Quantity pending', visibleOverview.totalPending],
  ] as const : [];

  return (
    <section aria-labelledby="daily-order-overview-title" className="my-7 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">Asia/Dhaka business date</p><h2 id="daily-order-overview-title" className="mt-1 text-xl font-bold">{title}</h2><p className="mt-1 text-sm text-slate-600">Only active Workers in this authorized workspace are included.</p></div>
        <label className="text-sm font-medium">Business date<input aria-label="Daily order business date" type="date" value={date} onChange={(event) => { setDate(event.target.value); setExpandedWorker(''); }} className="mt-1 block min-h-11 rounded-lg border border-slate-300 bg-white px-3" /></label>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading && <p role="status" className="mt-4 text-sm text-slate-600">Loading daily order data…</p>}
      {!workspaceId && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Select or configure a workspace to view daily orders.</p>}
      {visibleOverview && <>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {cards.map(([label, value]) => <article key={label} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4"><p className="text-xs leading-5 text-slate-600">{label}</p><p className="mt-1 break-words text-2xl font-bold tabular-nums">{value.toLocaleString()}</p></article>)}
        </div>
        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-100 text-slate-700"><tr><th className="px-3 py-3">Worker</th><th className="px-3 py-3">Account</th><th className="px-3 py-3">Order status</th><th className="px-3 py-3">Ordered</th><th className="px-3 py-3">Fulfilled</th><th className="px-3 py-3">Pending</th><th className="px-3 py-3">Details</th></tr></thead>
            <tbody>{visibleOverview.workers.map((worker) => <Fragment key={worker.id}>
              <tr key={worker.id} className="border-t border-slate-200"><td className="max-w-56 truncate px-3 py-3 font-medium" title={`${worker.name} (@${worker.username})`}>{worker.name}<span className="block truncate text-xs font-normal text-slate-500">@{worker.username}</span></td><td className="px-3 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">Active</span></td><td className="px-3 py-3">{worker.orderStatus === 'ordered' ? 'Ordered today' : 'No order today'}</td><td className="px-3 py-3 tabular-nums">{worker.ordered}</td><td className="px-3 py-3 tabular-nums">{worker.fulfilled}</td><td className="px-3 py-3 tabular-nums">{worker.pending}</td><td className="px-3 py-3"><button type="button" aria-expanded={expandedWorker === worker.id} onClick={() => setExpandedWorker((current) => current === worker.id ? '' : worker.id)} className="min-h-10 rounded-lg border border-slate-300 px-3 font-semibold hover:bg-slate-50">{expandedWorker === worker.id ? 'Hide orders' : 'View orders'}</button></td></tr>
              {expandedWorker === worker.id && <tr key={`${worker.id}-details`} className="border-t bg-slate-50"><td colSpan={7} className="p-3">{worker.orders.length ? <ul className="grid gap-2 sm:grid-cols-2">{worker.orders.map((order) => <li key={order.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm"><p className="font-semibold">Order · {new Date(order.requestDate).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} (Dhaka)</p><p className="mt-1">Requested {order.requestedQuantity} · Fulfilled {order.deliveredQuantity} · Pending {order.pendingQuantity}</p><p className="mt-1 text-xs capitalize text-slate-600">{order.status.replaceAll('_', ' ')}</p></li>)}</ul> : <p className="text-sm text-slate-600">No orders for this Worker on {visibleOverview.date}.</p>}</td></tr>}
            </Fragment>)}</tbody>
          </table>
          {!visibleOverview.workers.length && <p className="p-5 text-center text-sm text-slate-600">No active Workers in this workspace.</p>}
        </div>
      </>}
    </section>
  );
}
