import { useState, type FormEvent } from 'react';
import type { AuthorSettings } from '../server/settings/service.ts';
import type { Category, Tag } from '../server/taxonomy/service.ts';
import { api, ApiError, errorMessage, setCsrfToken } from './api.ts';
import { ToastProvider, useConfirm, useToast } from './ui.tsx';

export default function Settings(props: { author: AuthorSettings; categories: Category[]; tags: Tag[]; username: string }) {
  return <ToastProvider><SettingsInner {...props} /></ToastProvider>;
}

function SettingsInner({ author: initialAuthor, categories: initialCategories, tags: initialTags, username }: {
  author: AuthorSettings; categories: Category[]; tags: Tag[]; username: string;
}) {
  return (
    <main className="admin-main">
      <div className="page-head"><div><h1>Settings</h1><p>Signed in as <strong>{username}</strong>.</p></div></div>
      <div className="settings-grid">
        <PasswordPanel />
        <AuthorPanel initial={initialAuthor} />
        <CategoryPanel initial={initialCategories} />
        <TagPanel initial={initialTags} />
      </div>
    </main>
  );
}

function PasswordPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!current) local.current = 'Enter your current password.';
    if (next.length < 12) local.next = 'Use at least 12 characters.';
    if (next !== confirmPw) local.confirm = 'The passwords do not match.';
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const res = await api.post<{ csrfToken: string }>('/api/admin/password', { current, next });
      setCsrfToken(res.csrfToken);
      setCurrent(''); setNext(''); setConfirmPw('');
      toast('Password changed. All other devices have been signed out.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const type = show ? 'text' : 'password';
  return (
    <section className="panel" aria-labelledby="pw-title">
      <h2 id="pw-title">Change password</h2>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="pw-current">Current password</label>
          <input id="pw-current" className="input" type={type} autoComplete="current-password" value={current}
            onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!errors.current} />
          {errors.current && <span className="err">{errors.current}</span>}
        </div>
        <div className="field">
          <label htmlFor="pw-next">New password</label>
          <input id="pw-next" className="input" type={type} autoComplete="new-password" value={next}
            onChange={(e) => setNext(e.target.value)} aria-invalid={!!errors.next} aria-describedby="pw-hint" />
          <span className="hint" id="pw-hint">At least 12 characters. A short sentence works well.</span>
          {errors.next && <span className="err">{errors.next}</span>}
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">Confirm new password</label>
          <input id="pw-confirm" className="input" type={type} autoComplete="new-password" value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)} aria-invalid={!!errors.confirm} />
          {errors.confirm && <span className="err">{errors.confirm}</span>}
        </div>
        <label className="check" style={{ marginBottom: 14 }}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
        <button type="submit" className="a-btn primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
      </form>
    </section>
  );
}

function AuthorPanel({ initial }: { initial: AuthorSettings }) {
  const toast = useToast();
  const [author, setAuthor] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.put<{ author: AuthorSettings }>('/api/admin/settings', { author });
      setAuthor(res.author);
      setErrors({});
      toast('Author details saved.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^author\./, ''), v])));
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="author-title">
      <h2 id="author-title">Author</h2>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="a-name">Name</label>
          <input id="a-name" className="input" value={author.name} maxLength={100} onChange={(e) => setAuthor({ ...author, name: e.target.value })} aria-invalid={!!errors.name} />
          <span className="hint">Used as the default author on new articles.</span>
          {errors.name && <span className="err">{errors.name}</span>}
        </div>
        <div className="field">
          <label htmlFor="a-role">Role</label>
          <input id="a-role" className="input" value={author.role} maxLength={120} onChange={(e) => setAuthor({ ...author, role: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="a-bio">Short bio</label>
          <textarea id="a-bio" className="textarea" value={author.bio} maxLength={600} onChange={(e) => setAuthor({ ...author, bio: e.target.value })} />
          <span className="hint">Shown under every article.</span>
        </div>
        <button type="submit" className="a-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save author'}</button>
      </form>
    </section>
  );
}

function CategoryPanel({ initial }: { initial: Category[] }) {
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [items, setItems] = useState(initial);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const saved = editing
        ? await api.patch<Category>(`/api/admin/categories/${editing.id}`, { name, description })
        : await api.post<Category>('/api/admin/categories', { name, description });
      setItems((list) => [...list.filter((c) => c.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setName(''); setDescription(''); setEditing(null);
      toast(editing ? 'Category updated.' : 'Category added.');
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.fields)[0] ?? err.message : errorMessage(err));
    }
  }

  async function remove(c: Category) {
    const ok = await confirm({ title: `Delete “${c.name}”?`, message: `It will be removed from ${c.postCount} article${c.postCount === 1 ? '' : 's'}. The articles themselves are kept.`, confirmLabel: 'Delete category', danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/admin/categories/${c.id}`);
      setItems((list) => list.filter((x) => x.id !== c.id));
      toast('Category deleted.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <section className="panel" aria-labelledby="cat-title">
      {confirmNode}
      <h2 id="cat-title">Categories</h2>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="c-name">{editing ? `Rename “${editing.name}”` : 'New category'}</label>
          <input id="c-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-invalid={!!error} />
          {error && <span className="err">{error}</span>}
        </div>
        <div className="field">
          <label htmlFor="c-desc">Description (shown on the category page)</label>
          <input id="c-desc" className="input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="a-btn primary" disabled={!name.trim()}>{editing ? 'Save' : 'Add category'}</button>
          {editing && <button type="button" className="a-btn" onClick={() => { setEditing(null); setName(''); setDescription(''); }}>Cancel</button>}
        </div>
      </form>
      <ul className="tax-list" style={{ marginTop: 16 }}>
        {items.length === 0 && <li className="hint">No categories yet.</li>}
        {items.map((c) => (
          <li key={c.id}>
            <span><strong>{c.name}</strong> <span className="hint">· {c.postCount} article{c.postCount === 1 ? '' : 's'}</span></span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="a-btn sm" onClick={() => { setEditing(c); setName(c.name); setDescription(c.description); }}>Edit</button>
              <button type="button" className="a-btn sm danger" onClick={() => remove(c)} aria-label={`Delete category ${c.name}`}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TagPanel({ initial }: { initial: Tag[] }) {
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [items, setItems] = useState(initial);
  async function remove(t: Tag) {
    const ok = await confirm({ title: `Delete tag “${t.name}”?`, message: `It will be removed from ${t.postCount} article${t.postCount === 1 ? '' : 's'}.`, confirmLabel: 'Delete tag', danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/admin/tags/${t.id}`);
      setItems((list) => list.filter((x) => x.id !== t.id));
      toast('Tag deleted.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }
  return (
    <section className="panel" aria-labelledby="tag-title">
      {confirmNode}
      <h2 id="tag-title">Tags</h2>
      <p className="hint" style={{ fontSize: 13.5, color: 'var(--muted)' }}>Tags are created from the article editor.</p>
      <ul className="tax-list" style={{ marginTop: 8 }}>
        {items.length === 0 && <li className="hint">No tags yet.</li>}
        {items.map((t) => (
          <li key={t.id}>
            <span>#{t.name} <span className="hint">· {t.postCount}</span></span>
            <button type="button" className="a-btn sm danger" onClick={() => remove(t)} aria-label={`Delete tag ${t.name}`}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
