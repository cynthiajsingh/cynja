import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate, formatDateTime } from '../lib/format.ts';
import type { AdminListItem, AdminPost, Page } from '../server/posts/types.ts';
import { api, errorMessage } from './api.ts';
import { StatusBadge, ToastProvider, useConfirm, useToast } from './ui.tsx';

interface Stats { total: number; published: number; drafts: number; scheduled: number }
interface Category { id: number; name: string }
interface Filters {
  q: string; status: string; categoryId: string; dateField: 'updated' | 'created' | 'published';
  from: string; to: string; order: 'desc' | 'asc'; page: number;
}

const DEFAULTS: Filters = { q: '', status: '', categoryId: '', dateField: 'updated', from: '', to: '', order: 'desc', page: 1 };

function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== '' && !(k in DEFAULTS && DEFAULTS[k as keyof Filters] === v)) p.set(k, String(v));
  return p.toString();
}

function fromUrl(): Filters {
  const p = new URLSearchParams(location.search);
  const f = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof Filters)[]) {
    const v = p.get(k);
    if (v !== null) (f as Record<string, unknown>)[k] = k === 'page' ? Math.max(1, Number(v) || 1) : v;
  }
  return f;
}

export default function Dashboard(props: { stats: Stats; recent: AdminListItem[]; categories: Category[] }) {
  return <ToastProvider><DashboardInner {...props} /></ToastProvider>;
}

function DashboardInner({ stats: initialStats, recent: initialRecent, categories }: { stats: Stats; recent: AdminListItem[]; categories: Category[] }) {
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [list, setList] = useState<Page<AdminListItem> | null>(null);
  const [stats, setStats] = useState(initialStats);
  const [recent, setRecent] = useState(initialRecent);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const searchTimer = useRef<number>(undefined);
  const [qInput, setQInput] = useState('');

  useEffect(() => {
    const f = fromUrl();
    setFilters(f);
    setQInput(f.q);
  }, []);

  const load = useCallback(async (f: Filters, signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      setList(await api.get<Page<AdminListItem>>(`/api/admin/posts?${toQuery(f)}`, signal));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const qs = toQuery(filters);
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
    void load(filters, ctrl.signal);
    return () => ctrl.abort();
  }, [filters, load]);

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  async function refreshSide() {
    const fresh = await api.get<{ stats: Stats; recent: AdminListItem[] }>('/api/admin/stats');
    setStats(fresh.stats);
    setRecent(fresh.recent);
  }

  async function createPost() {
    setCreating(true);
    try {
      const post = await api.post<AdminPost>('/api/admin/posts');
      window.location.href = `/admin/blogs/${post.id}`;
    } catch (err) {
      toast(errorMessage(err), 'error');
      setCreating(false);
    }
  }

  async function act(item: AdminListItem, action: 'publish' | 'unpublish') {
    setBusyId(item.id);
    try {
      const fresh = await api.get<AdminPost>(`/api/admin/posts/${item.id}`);
      await api.post(`/api/admin/posts/${item.id}/status`, { action, revision: fresh.revision });
      toast(action === 'publish' ? `“${item.title || 'Untitled'}” is now live.` : `“${item.title || 'Untitled'}” was unpublished.`);
      await load(filters);
      await refreshSide();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: AdminListItem) {
    const ok = await confirm({
      title: 'Delete this article?',
      message: <>“{item.title || 'Untitled'}” will be permanently deleted{item.isLive ? ' and removed from the public blog' : ''}. This cannot be undone.</>,
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      await api.del(`/api/admin/posts/${item.id}`);
      toast('Article deleted.');
      await load(filters);
      await refreshSide();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  }

  const dateOf = (i: AdminListItem) => (filters.dateField === 'created' ? i.createdAt : filters.dateField === 'published' ? i.publishedAt : i.updatedAt);
  const filtered = toQuery({ ...filters, page: 1 }) !== '';

  return (
    <main className="admin-main">
      {confirmNode}
      <div className="page-head">
        <div>
          <h1>Articles</h1>
          <p>Write, schedule and publish posts for cynja.in/blogs.</p>
        </div>
        <button type="button" className="a-btn primary" style={{ minHeight: 46, padding: '0 22px' }} onClick={createPost} disabled={creating}>
          {creating ? 'Creating…' : '＋ Create New Blog'}
        </button>
      </div>

      <section className="stats" aria-label="Article counts">
        <div className="stat"><div className="n">{stats.total}</div><div className="l">Total</div></div>
        <div className="stat"><div className="n">{stats.published}</div><div className="l">Published</div></div>
        <div className="stat"><div className="n">{stats.drafts}</div><div className="l">Drafts</div></div>
        <div className="stat"><div className="n">{stats.scheduled}</div><div className="l">Scheduled</div></div>
      </section>

      <div className="dash-grid">
        <section className="panel" aria-labelledby="all-articles">
          <div className="panel-head"><h2 id="all-articles">All articles</h2>
            {filtered && <button type="button" className="a-btn sm ghost" onClick={() => { setQInput(''); setFilters(DEFAULTS); }}>Clear filters</button>}
          </div>
          <div className="filters" role="search">
            <div className="field">
              <label htmlFor="f-q">Search</label>
              <input id="f-q" className="input" type="search" placeholder="Title or content…" value={qInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setQInput(v);
                  window.clearTimeout(searchTimer.current);
                  searchTimer.current = window.setTimeout(() => update({ q: v.trim() }), 300);
                }} />
            </div>
            <div className="field">
              <label htmlFor="f-status">Status</label>
              <select id="f-status" className="select" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
                <option value="">All</option><option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option><option value="published">Published</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-cat">Category</label>
              <select id="f-cat" className="select" value={filters.categoryId} onChange={(e) => update({ categoryId: e.target.value })}>
                <option value="">All</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-sort">Sort by</label>
              <select id="f-sort" className="select" value={`${filters.dateField}:${filters.order}`}
                onChange={(e) => { const [d, o] = e.target.value.split(':'); update({ dateField: d as Filters['dateField'], order: o as Filters['order'] }); }}>
                <option value="updated:desc">Last updated</option>
                <option value="created:desc">Newest created</option>
                <option value="created:asc">Oldest created</option>
                <option value="published:desc">Recently published</option>
                <option value="published:asc">First published</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-from">From</label>
              <input id="f-from" className="input" type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="f-to">To</label>
              <input id="f-to" className="input" type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} />
            </div>
          </div>

          {error ? (
            <div className="empty" role="alert"><h3>Couldn't load articles</h3><p>{error}</p>
              <button type="button" className="a-btn" style={{ marginTop: 12 }} onClick={() => load(filters)}>Retry</button></div>
          ) : !list && loading ? (
            <div className="empty" aria-busy="true">Loading articles…</div>
          ) : list && list.items.length === 0 ? (
            filtered
              ? <div className="empty"><h3>No matching articles</h3><p>Try a different search or clear the filters.</p></div>
              : <div className="empty"><h3>No articles yet</h3><p>Start your first post — it stays private until you publish it.</p>
                  <button type="button" className="a-btn primary" style={{ marginTop: 14 }} onClick={createPost}>Create New Blog</button></div>
          ) : list && (
            <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }} aria-busy={loading}>
              <table className="post-table">
                <thead><tr><th scope="col">Title</th><th scope="col">Status</th><th scope="col">{filters.dateField === 'created' ? 'Created' : filters.dateField === 'published' ? 'Published' : 'Updated'}</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {list.items.map((item) => (
                    <tr key={item.id}>
                      <td className="title">
                        <a href={`/admin/blogs/${item.id}`}>{item.title || 'Untitled draft'}</a>
                        <div className="sub">/blogs/{item.slug}{item.categories.length ? ` · ${item.categories.map((c) => c.name).join(', ')}` : ''} · {item.wordCount} words</div>
                      </td>
                      <td>
                        <StatusBadge status={item.status} isLive={item.isLive} pending={item.hasPendingChanges} />
                        {item.featured && <> <span className="badge featured">Featured</span></>}
                        {item.status === 'scheduled' && !item.isLive && item.publishedAt && <div className="sub">for {formatDateTime(item.publishedAt)}</div>}
                      </td>
                      <td>{dateOf(item) ? formatDate(dateOf(item)!) : '—'}</td>
                      <td>
                        <div className="row-actions">
                          <a className="a-btn sm" href={`/admin/blogs/${item.id}`}>Edit</a>
                          <a className="a-btn sm" href={`/admin/preview/${item.id}`} target="_blank" rel="noopener">Preview</a>
                          {item.isLive
                            ? <button type="button" className="a-btn sm" disabled={busyId === item.id} onClick={() => act(item, 'unpublish')}>Unpublish</button>
                            : <button type="button" className="a-btn sm" disabled={busyId === item.id} onClick={() => act(item, 'publish')}>Publish</button>}
                          <button type="button" className="a-btn sm danger" disabled={busyId === item.id} onClick={() => remove(item)} aria-label={`Delete “${item.title || 'Untitled'}”`}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pager">
                <span>{list.total} article{list.total === 1 ? '' : 's'} · page {list.page} of {list.pageCount}</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="a-btn sm" disabled={list.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>← Previous</button>
                  <button type="button" className="a-btn sm" disabled={list.page >= list.pageCount} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next →</button>
                </span>
              </div>
            </div>
          )}
        </section>

        <aside className="panel" aria-labelledby="recent-title">
          <div className="panel-head"><h2 id="recent-title">Recently edited</h2></div>
          {recent.length === 0 ? <div className="empty" style={{ padding: 24 }}>Nothing yet.</div> : (
            <ul className="recent">
              {recent.map((r) => (
                <li key={r.id}>
                  <a href={`/admin/blogs/${r.id}`}>{r.title || 'Untitled draft'}</a>
                  <span className="sub" style={{ color: 'var(--muted)', fontSize: 12.5, whiteSpace: 'nowrap' }}>{formatDate(r.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}
