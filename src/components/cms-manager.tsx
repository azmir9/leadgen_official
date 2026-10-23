'use client';

import { useEffect, useEffectEvent, useState } from 'react';

type CmsType = 'blog' | 'service' | 'free-service' | 'offer' | 'banner' | 'page';
type CmsStatus = 'draft' | 'published' | 'archived';
type CmsItem = { id: string; type: CmsType; title: string; slug: string; summary: string; content: string; imageUrl: string; imageAlt: string; seoTitle: string; seoDescription: string; status: CmsStatus; publishAt: string | null };
type CmsForm = Omit<CmsItem, 'id' | 'publishAt'> & { publishAt: string };
const emptyForm: CmsForm = { type: 'blog', title: '', slug: '', summary: '', content: '', imageUrl: '', imageAlt: '', seoTitle: '', seoDescription: '', status: 'draft', publishAt: '' };

export function CmsManager() {
  const [items, setItems] = useState<CmsItem[]>([]);
  const [form, setForm] = useState<CmsForm>(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadItems() {
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '30' });
      if (query) params.set('q', query);
      const response = await fetch(`/api/cms?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to load website content.');
      setItems(result.items); setTotal(result.total); setHasMore(result.hasMore);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load website content.'); }
  }

  const refreshCmsList = useEffectEvent(() => loadItems());
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshCmsList(); }, [page, query]);

  function editItem(item: CmsItem) {
    setEditingId(item.id);
    setForm({ ...item, publishAt: item.publishAt ? new Date(item.publishAt).toISOString().slice(0, 16) : '' });
    setNotice(''); setError('');
  }

  function resetForm() { setEditingId(''); setForm(emptyForm); }

  async function saveContent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const body = { ...form, ...(editingId ? { id: editingId } : {}), publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : null };
      const response = await fetch('/api/cms', { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to save content.');
      setNotice(editingId ? 'Content updated.' : 'Content created.'); resetForm(); await loadItems();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save content.'); }
    finally { setBusy(false); }
  }

  async function archiveItem(item: CmsItem) {
    if (!window.confirm(`Archive “${item.title}”?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/cms/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to archive content.');
      setNotice('Content archived.'); if (editingId === item.id) resetForm(); await loadItems();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to archive content.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="mt-9 border-t border-slate-200 pt-7">
      <h2 className="text-xl font-bold">Website content management</h2>
      <p className="mt-1 text-sm text-slate-600">Create and schedule public pages, services, offers, banners, and blog entries.</p>
      {error && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <form onSubmit={saveContent} className="mt-4 grid gap-3 border-t-4 border-blue-600 bg-white p-5 shadow-sm sm:grid-cols-2">
        <div className="flex items-center justify-between sm:col-span-2"><h3 className="font-bold">{editingId ? 'Edit content' : 'New content'}</h3>{editingId && <button type="button" onClick={resetForm} className="text-sm font-semibold text-blue-700">Cancel edit</button>}</div>
        <label className="block text-sm font-medium">Content type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as CmsType })} className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2">{['blog', 'service', 'free-service', 'offer', 'banner', 'page'].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="block text-sm font-medium">Publication status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as CmsStatus })} className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2"><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
        <label className="block text-sm font-medium">Title<input required maxLength={180} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value, slug: editingId ? form.slug : event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium">Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={180} value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium sm:col-span-2">Summary<input maxLength={500} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium sm:col-span-2">Content<textarea rows={6} maxLength={100000} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium">Image URL<input type="url" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium">Image alt text<input maxLength={300} value={form.imageAlt} onChange={(event) => setForm({ ...form, imageAlt: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium">SEO title<input maxLength={180} value={form.seoTitle} onChange={(event) => setForm({ ...form, seoTitle: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium">SEO description<input maxLength={500} value={form.seoDescription} onChange={(event) => setForm({ ...form, seoDescription: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <label className="block text-sm font-medium">Schedule publication<input type="datetime-local" value={form.publishAt} onChange={(event) => setForm({ ...form, publishAt: event.target.value })} className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label>
        <button disabled={busy} className="btn btn-primary self-end">{busy ? 'Saving…' : editingId ? 'Save changes' : 'Create content'}</button>
      </form>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-bold">Content library</h3><p className="text-xs text-slate-500">{total} entries</p></div><form onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }} className="flex gap-2"><label className="sr-only" htmlFor="cms-search">Search content</label><input id="cms-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or text" className="rounded border border-slate-300 px-3 py-2 text-sm" /><button className="btn btn-secondary">Search</button></form></div>
      <div className="mt-3 overflow-x-auto border border-slate-200 bg-white"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="px-3 py-3">Content</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Publish date</th><th className="px-3 py-3">Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="px-3 py-3"><span className="font-semibold">{item.title}</span><span className="block text-xs text-slate-500">/{item.slug}</span></td><td className="px-3 py-3">{item.type}</td><td className="px-3 py-3">{item.status}</td><td className="px-3 py-3">{item.publishAt ? new Date(item.publishAt).toLocaleString() : 'Immediate'}</td><td className="px-3 py-3"><div className="flex gap-2"><button type="button" onClick={() => editItem(item)} className="rounded border border-slate-300 px-2 py-1">Edit</button>{item.status !== 'archived' && <button type="button" disabled={busy} onClick={() => void archiveItem(item)} className="rounded border border-red-200 px-2 py-1 text-red-700">Archive</button>}</div></td></tr>)}{items.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No content matches this search.</td></tr>}</tbody></table></div>
      <div className="mt-3 flex justify-end gap-2"><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="btn btn-secondary disabled:opacity-50">Previous</button><span className="px-2 py-2 text-sm">Page {page}</span><button disabled={!hasMore} onClick={() => setPage((current) => current + 1)} className="btn btn-secondary disabled:opacity-50">Next</button></div>
    </section>
  );
}
