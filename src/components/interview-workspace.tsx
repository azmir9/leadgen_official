'use client';

import Link from 'next/link';
import { useEffect, useEffectEvent, useState } from 'react';

type InterviewItem = {
  id: string; workerId: string; workerName: string | null; workerUsername?: string | null; workerEmail?: string | null;
  workerStatus?: string | null; service: string; category?: string | null; experienceAmount?: number | null;
  experienceUnit?: string | null; dailyLeadCapacity?: number | null; workArrangement?: string | null;
  platforms?: string[]; description?: string; contact?: Record<string, string>; answers: Record<string, string>;
  status: string; submittedAt: string; revision: number;
  history?: { category?: string; answers?: Record<string, string>; experienceAmount?: number; experienceUnit?: string; dailyLeadCapacity?: number; workArrangement?: string; platforms?: string[]; description?: string; contact?: Record<string, string>; submittedAt?: string; revision?: number }[];
};
type Worker = { id: string; name: string; username: string; status: string };
type Mode = 'worker' | 'onboarding' | 'admin' | 'super-admin';
const categories = [
  { key: 'lead-generation', name: 'Lead Generation', featured: true },
  { key: 'facebook-marketing', name: 'Facebook Marketing' }, { key: 'google-ads', name: 'Google Ads' },
  { key: 'google-seo', name: 'Google SEO' }, { key: 'youtube-marketing', name: 'YouTube Marketing' },
  { key: 'social-media-marketing', name: 'Social Media Marketing' }, { key: 'telegram-marketing', name: 'Telegram Marketing' },
  { key: 'other-freelancing', name: 'Other Freelancing Work' },
];
const platformOptions = ['Free Sites', 'Paid Sites', 'Posting Sites'];
const statusLabels: Record<string, string> = { pending_review: 'Pending Review', submitted: 'Pending Review', reviewed: 'Reviewed', approved: 'Approved', reset: 'Reset' };

export function InterviewWorkspace({ mode, workers = [], workspaceId = null }: { mode: Mode; workers?: Worker[]; workspaceId?: string | null }) {
  const [items, setItems] = useState<InterviewItem[]>([]);
  const [workerDetails, setWorkerDetails] = useState<{ name: string; email: string } | null>(null);
  const [selectedWorker, setSelectedWorker] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('lead-generation');
  const [experienceAmount, setExperienceAmount] = useState('');
  const [experienceUnit, setExperienceUnit] = useState('months');
  const [dailyLeadCapacity, setDailyLeadCapacity] = useState('');
  const [workArrangement, setWorkArrangement] = useState('individual');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState({ contactNumber: '', facebook: '', whatsapp: '', telegram: '', additional: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submissionComplete, setSubmissionComplete] = useState(false);

  async function loadInterviews() {
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ limit: '100' });
      if (mode !== 'worker' && mode !== 'onboarding' && selectedWorker) query.set('workerId', selectedWorker);
      if (mode === 'super-admin' && workspaceId) query.set('workspaceId', workspaceId);
      if (mode === 'onboarding') query.set('onboarding', '1');
      if (mode !== 'worker' && mode !== 'onboarding' && statusFilter) query.set('status', statusFilter);
      if (mode !== 'worker' && mode !== 'onboarding' && search.trim()) query.set('q', search.trim());
      const response = await fetch(`/api/interviews?${query}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to load interviews.');
      setItems(result.interviews);
      if (result.worker) setWorkerDetails(result.worker);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load interviews.'); }
    finally { setLoading(false); }
  }

  const refreshInterviewList = useEffectEvent(() => loadInterviews());
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshInterviewList(); }, [mode, selectedWorker, statusFilter, search, workspaceId]);

  async function submitInterview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/interviews${mode === 'onboarding' ? '?onboarding=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        category, experienceAmount, experienceUnit, dailyLeadCapacity, workArrangement,
        platforms: selectedPlatforms, description, contact,
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to submit interview.');
      setNotice('Interview Submitted Successfully! Please wait while our team reviews your interview. You will be able to access your Worker Dashboard after approval.');
      if (mode === 'onboarding') setSubmissionComplete(true);
      else await loadInterviews();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to submit interview. Your entered answers are still available.'); }
    finally { setBusy(false); }
  }

  async function updateInterview(item: InterviewItem, action: 'review' | 'reset' | 'approve') {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/interviews', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interviewId: item.id, action, workspaceId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to update interview.');
      setNotice(action === 'reset' ? 'Interview reset. The Worker may submit a new revision.' : action === 'approve' ? 'Interview approved and Worker account activated.' : 'Interview marked reviewed.');
      await loadInterviews();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update interview.'); }
    finally { setBusy(false); }
  }

  const activeInterviews = items.filter((item) => item.status !== 'reset');
  const activeInterview = activeInterviews[0];
  const formatCategory = (item: InterviewItem) => categories.find((option) => option.key === (item.category || item.service))?.name || item.service;

  return (
    <section className="mt-4 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-xl font-bold">{mode === 'admin' || mode === 'super-admin' ? 'Interview review' : 'Worker Interview'}</h2>
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <div role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><p className="font-bold">{notice}</p>{mode === 'onboarding' && <Link href="/login" className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-emerald-800 px-4 font-semibold text-white">Continue to Login</Link>}</div>}

      {mode === 'worker' || mode === 'onboarding' ? <>
        {workerDetails && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><p><span className="font-semibold">Full Name (required):</span> {workerDetails.name}</p><p><span className="font-semibold">Registered email:</span> {workerDetails.email || 'Not available'}</p></div>}
        {submissionComplete ? <p className="mt-5 rounded-xl border border-slate-200 p-4 text-sm">Your interview is saved as Pending Review. You may continue to the Login page.</p> : activeInterview ? <div className="mt-5 space-y-3">{activeInterviews.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4">
          <h3 className="font-bold">{formatCategory(item)} · {statusLabels[item.status] || item.status}</h3>
          <p className="mt-1 text-sm text-slate-600">Submitted {new Date(item.submittedAt).toLocaleString()}</p>
          <p className="mt-3 text-sm">Your interview is saved. Dashboard access remains pending until an Admin approves your account.</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(item.answers || {}).map(([question, answer]) => <div key={`${item.id}-${question}`} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-500">{question}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{answer}</dd></div>)}</dl>
        </article>)}</div> : <form onSubmit={submitInterview} className="mt-5 space-y-6">
          <fieldset>
            <legend className="text-lg font-bold">A · Select Your Work Category</legend>
            <p className="mt-1 text-sm text-slate-600">Which type of work do you want to do with Leadgen Official? <span className="font-semibold text-red-700">Choose one.</span></p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{categories.map((option) => <label key={option.key} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${option.featured ? 'border-blue-500 bg-blue-50 font-bold sm:col-span-2' : 'border-slate-200'}`}><input type="radio" name="category" value={option.key} checked={category === option.key} onChange={() => setCategory(option.key)} required /><span>{option.name}{option.featured ? ' · Main category' : ''}</span></label>)}</div>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-lg font-bold">B · Work Experience</legend>
            <label className="block text-sm font-medium">How long have you been doing this type of work? <span className="text-red-700">Required</span><span className="mt-1 flex gap-2"><input required type="number" min="0" max="1000" step="0.1" value={experienceAmount} onChange={(event) => setExperienceAmount(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3" placeholder="e.g. 6" /><select value={experienceUnit} onChange={(event) => setExperienceUnit(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3"><option value="months">Months</option><option value="years">Years</option></select></span></label>
            <label className="block text-sm font-medium">How many leads can you provide per day? <span className="text-red-700">Required</span><input required type="number" min="0" max="1000000" step="1" value={dailyLeadCapacity} onChange={(event) => setDailyLeadCapacity(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" placeholder="Enter a whole number" /></label>
          </fieldset>

          <fieldset>
            <legend className="text-lg font-bold">C · Individual or Team</legend><p className="mt-1 text-sm text-slate-600">How do you work? <span className="text-red-700">Required</span></p>
            <div className="mt-2 flex flex-wrap gap-3">{[['individual', 'I work individually.'], ['team', 'I work with a team.']].map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3"><input type="radio" name="arrangement" value={value} checked={workArrangement === value} onChange={() => setWorkArrangement(value)} required />{label}</label>)}</div>
          </fieldset>

          <fieldset>
            <legend className="text-lg font-bold">D · Work Platform</legend><p className="mt-1 text-sm text-slate-600">Which type of platform do you use? Select any that apply.</p>
            <div className="mt-2 flex flex-wrap gap-3">{platformOptions.map((option) => <label key={option} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3"><input type="checkbox" checked={selectedPlatforms.includes(option)} onChange={(event) => setSelectedPlatforms((current) => event.target.checked ? [...current, option] : current.filter((item) => item !== option))} />{option}</label>)}</div>
          </fieldset>

          <label className="block text-sm font-medium"><span className="text-lg font-bold">E · Knowledge and Experience Description</span><span className="mt-1 block text-sm font-normal text-slate-600">How much do you know about Lead Generation and this type of work? Share your understanding, process, skills, or anything else for the Admin. Optional.</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={5} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Describe your understanding of lead generation, how you work, relevant skills, or other details." /><span className="text-xs text-slate-500">{description.length}/5000</span></label>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-3 text-lg font-bold">F · Personal &amp; Contact Details</legend>
            <label className="block text-sm font-medium">Full Name <span className="text-red-700">Required</span><input value={workerDetails?.name || ''} readOnly required className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-slate-100 px-3" /></label>
            <label className="block text-sm font-medium">Email Address <span className="text-slate-500">(registered)</span><input type="email" value={workerDetails?.email || ''} readOnly className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-slate-100 px-3" /></label>
            {([
              ['contactNumber', 'Contact Number', 'tel'], ['facebook', 'Facebook Profile or ID Link', 'text'],
              ['whatsapp', 'WhatsApp Number', 'tel'], ['telegram', 'Telegram Username or Contact', 'text'],
              ['additional', 'Additional Contact Information', 'text'],
            ] as const).map(([key, label, type]) => <label key={key} className="block text-sm font-medium">{label} <span className="text-slate-500">(optional)</span><input type={type} value={contact[key]} onChange={(event) => setContact((current) => ({ ...current, [key]: event.target.value }))} maxLength={key === 'additional' ? 500 : 300} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>)}
          </fieldset>
          <button type="submit" disabled={busy || loading} className="btn btn-primary min-h-12 w-full px-5 py-3 font-bold disabled:opacity-60">{busy ? 'Saving interview…' : 'Submit Interview'}</button>
          <p className="text-center text-sm text-slate-600">Your account remains pending until an Admin approves your interview.</p>
        </form>}
      </> : <>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="text-sm font-medium">Search interviews<input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" placeholder="Name, username, or email" /></label>
          <label className="text-sm font-medium">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="">All statuses</option><option value="pending_review">Pending Review</option><option value="reviewed">Reviewed</option><option value="approved">Approved</option></select></label>
          {workers.length > 0 && <label className="text-sm font-medium">Worker<select value={selectedWorker} onChange={(event) => setSelectedWorker(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="">All workers in this workspace</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} (@{worker.username})</option>)}</select></label>}
          <button type="button" onClick={() => void loadInterviews()} className="btn btn-secondary min-h-11 self-end px-4">Refresh</button>
        </div>
        <div className="mt-4 space-y-3">{items.map((item) => <article key={item.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-bold">{item.workerName || 'Worker unavailable'} · {formatCategory(item)}</h3><p className="mt-1 break-all text-sm text-slate-600">@{item.workerUsername || item.workerId}{item.workerEmail ? ` · ${item.workerEmail}` : ''}</p><p className="text-xs text-slate-500">Interview: {statusLabels[item.status] || item.status} · Account: {item.workerStatus || 'unknown'} · Submitted {new Date(item.submittedAt).toLocaleString()}</p></div><div className="flex flex-wrap gap-2">{item.status === 'pending_review' || item.status === 'submitted' ? <button type="button" disabled={busy} onClick={() => void updateInterview(item, 'review')} className="min-h-11 rounded-lg bg-blue-100 px-3 text-sm font-semibold text-blue-900">Mark reviewed</button> : null}{item.workerStatus === 'pending' && ['pending_review', 'submitted', 'reviewed'].includes(item.status) && <button type="button" disabled={busy} onClick={() => void updateInterview(item, 'approve')} className="min-h-11 rounded-lg bg-emerald-100 px-3 text-sm font-semibold text-emerald-900">Approve Worker</button>}{item.status !== 'reset' && item.status !== 'approved' && <button type="button" disabled={busy} onClick={() => void updateInterview(item, 'reset')} className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm font-semibold text-amber-900">Reset interview</button>}</div></div>
          <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Full Name" value={item.workerName || 'Unavailable'} /><Detail label="Username" value={item.workerUsername ? `@${item.workerUsername}` : 'Unavailable'} /><Detail label="Email" value={item.workerEmail || 'Not provided'} />
            <Detail label="Contact Number" value={item.contact?.contactNumber || 'Not provided'} /><Detail label="Facebook" value={item.contact?.facebook || 'Not provided'} /><Detail label="WhatsApp" value={item.contact?.whatsapp || 'Not provided'} /><Detail label="Telegram" value={item.contact?.telegram || 'Not provided'} />
            <Detail label="Work Category" value={formatCategory(item)} /><Detail label="Experience" value={item.experienceAmount == null ? 'Legacy interview' : `${item.experienceAmount} ${item.experienceUnit}`} /><Detail label="Daily Lead Capacity" value={item.dailyLeadCapacity == null ? 'Not provided' : String(item.dailyLeadCapacity)} /><Detail label="Work Arrangement" value={item.workArrangement || 'Not provided'} /><Detail label="Platforms" value={item.platforms?.join(', ') || 'Not specified'} />
            <div className="min-w-0 rounded-lg bg-slate-50 p-3 sm:col-span-2 lg:col-span-3"><dt className="text-xs font-semibold uppercase text-slate-500">Knowledge and Experience</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{item.description || Object.values(item.answers || {}).join('\n') || 'Not provided'}</dd></div>
            {item.contact?.additional && <Detail label="Additional Contact" value={item.contact.additional} />}
            {item.history?.length ? <div className="min-w-0 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:col-span-2 lg:col-span-3"><dt className="text-xs font-semibold uppercase text-amber-900">Previous interview revisions</dt>{item.history.map((revision, index) => <dd key={`${item.id}-revision-${index}`} className="mt-2 text-sm">Revision {revision.revision ?? index + 1} · {revision.submittedAt ? new Date(revision.submittedAt).toLocaleString() : 'Submission date unavailable'} · {categories.find((option) => option.key === revision.category)?.name || 'Legacy interview'}</dd>)}</div> : null}
          </dl>
        </article>)}{loading && <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-600">Loading interviews…</p>}{!loading && items.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No interviews match these filters.</p>}</div>
      </>}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg bg-slate-50 p-3"><dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>;
}
