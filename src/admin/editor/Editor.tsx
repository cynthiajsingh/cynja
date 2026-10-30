import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { Placeholder } from '@tiptap/extensions';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatDateTime } from '../../lib/format.ts';
import type { MediaAsset } from '../../server/media/service.ts';
import type { AdminPost, ImageRef } from '../../server/posts/types.ts';
import { articleExtensions } from '../../shared/editor/schema.ts';
import { countWords, isValidSlug, readingMinutes, slugify } from '../../shared/text.ts';
import { api, ApiError, errorMessage } from '../api.ts';
import { MediaLibrary, uploadImage } from '../MediaLibrary.tsx';
import { Modal, StatusBadge, ToastProvider, useConfirm, useToast } from '../ui.tsx';
import { EmbedDialog, LinkDialog, ScheduleDialog, ShortcutsDialog } from './dialogs.tsx';
import { SearchReplace } from './searchReplace.ts';
import { ContextBar, FindBar, MOD, Toolbar } from './Toolbar.tsx';
import { useAutosave, type SaveState } from './useAutosave.ts';

interface Category { id: number; name: string }

interface Meta {
  title: string;
  excerpt: string;
  slug: string;
  slugAuto: boolean;
  coverImage: ImageRef | null;
  ogImage: ImageRef | null;
  authorName: string;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  categoryIds: number[];
  tags: string[];
}

const PLACEHOLDER_SLUG = /^untitled-[0-9a-f]{8}$/;

function initialMeta(post: AdminPost): Meta {
  return {
    title: post.title, excerpt: post.excerpt, slug: post.slug,
    slugAuto: PLACEHOLDER_SLUG.test(post.slug) || post.slug === slugify(post.title),
    coverImage: post.coverImage, ogImage: post.ogImage, authorName: post.authorName, featured: post.featured,
    seoTitle: post.seoTitle, seoDescription: post.seoDescription,
    categoryIds: post.categories.map((c) => c.id), tags: post.tags.map((t) => t.name),
  };
}

const assetToRef = (a: MediaAsset): ImageRef => ({ id: a.id, url: a.url, alt: a.altText, width: a.width, height: a.height });

export default function EditorApp(props: { post: AdminPost; categories: Category[]; siteUrl: string }) {
  return <ToastProvider><EditorPage {...props} /></ToastProvider>;
}

function SaveIndicator({ state, lastSavedAt, error, live }: { state: SaveState; lastSavedAt: Date | null; error: ApiError | null; live: boolean }) {
  const text = state === 'saving' ? 'Saving…'
    : state === 'dirty' ? 'Unsaved changes'
    : state === 'conflict' ? 'Save blocked: newer version elsewhere'
    : state === 'error' ? `Save failed${error?.isNetwork ? ' — offline? Retrying…' : ''}`
    : lastSavedAt ? `${live ? 'Changes saved privately' : 'Saved'} ${lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : 'All changes saved';
  return <span className="save-state" data-state={state} role="status" aria-live="polite"><span className="dot" aria-hidden="true" />{text}</span>;
}

function EditorPage({ post: initial, categories: initialCategories, siteUrl }: { post: AdminPost; categories: Category[]; siteUrl: string }) {
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [post, setPost] = useState(initial);
  const [meta, setMeta] = useState<Meta>(() => initialMeta(initial));
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const [categories, setCategories] = useState(initialCategories);
  const [words, setWords] = useState(initial.wordCount);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'link' | 'embed' | 'image' | 'cover' | 'og' | 'schedule' | 'shortcuts'>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const editorRef = useRef<TiptapEditor | null>(null);

  const getPayload = useCallback(() => {
    const m = metaRef.current;
    return {
      title: m.title, excerpt: m.excerpt, slug: m.slug, content: editorRef.current?.getJSON() ?? initial.content,
      coverImageId: m.coverImage?.id ?? null, ogImageId: m.ogImage?.id ?? null, authorName: m.authorName,
      featured: m.featured, seoTitle: m.seoTitle, seoDescription: m.seoDescription,
      categoryIds: m.categoryIds, tags: m.tags,
    };
  }, [initial.content]);

  const onSaved = useCallback((saved: AdminPost) => {
    setPost(saved);
    setFieldErrors({});
  }, []);

  const autosave = useAutosave({ postId: initial.id, initialRevision: initial.revision, getPayload, onSaved });

  useEffect(() => {
    if (autosave.state === 'error' && autosave.error?.fields) setFieldErrors(autosave.error.fields);
  }, [autosave.state, autosave.error]);

  const extensions = useMemo(() => [
    ...articleExtensions(),
    Placeholder.configure({ placeholder: 'Start writing your article…' }),
    SearchReplace,
  ], []);

  const insertFiles = useCallback(async (files: File[], pos?: number) => {
    for (const file of files) {
      try {
        toast(`Uploading ${file.name}…`);
        const asset = await uploadImage(file);
        const ed = editorRef.current;
        if (!ed) return;
        const chain = ed.chain().focus();
        if (pos !== undefined) chain.setTextSelection(pos);
        chain.insertFigureImage({ src: asset.url, alt: asset.altText, caption: '', mediaId: asset.id }).run();
      } catch (err) {
        toast(`${file.name}: ${errorMessage(err)}`, 'error');
      }
    }
  }, [toast]);

  const editor = useEditor({
    extensions,
    content: initial.content,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'prose', 'aria-label': 'Article content', role: 'textbox', 'aria-multiline': 'true' },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        void insertFiles(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertFiles(files, pos);
        return true;
      },
    },
    onUpdate: ({ editor: ed, transaction }) => {
      setWords(countWords(ed.getText()));
      if (transaction.docChanged) autosave.markDirty();
    },
  });
  editorRef.current = editor;

  const patch = (p: Partial<Meta>) => {
    setMeta((m) => ({ ...m, ...p }));
    autosave.markDirty();
  };

  // Keyboard shortcuts that span the whole editor page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void saveNow(); }
      else if (mod && e.key.toLowerCase() === 'k' && editor?.isFocused) { e.preventDefault(); setDialog('link'); }
      else if (mod && e.key.toLowerCase() === 'f' && editor?.isFocused) { e.preventDefault(); setFindOpen(true); }
      else if (e.key === 'Escape' && focusMode && !dialog) setFocusMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function saveNow(): Promise<boolean> {
    const ok = await autosave.flush();
    if (ok) toast(post.isLive ? 'Changes saved. Click Update to publish them.' : 'Draft saved.');
    else if (autosave.error) toast(autosave.error.message, 'error');
    return ok;
  }

  async function statusAction(action: 'publish' | 'unpublish' | 'update' | 'discard' | 'schedule', extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      if (action !== 'discard' && !(await autosave.flush())) {
        toast(autosave.error?.message ?? 'Save your changes before continuing.', 'error');
        return;
      }
      const updated = await api.post<AdminPost>(`/api/admin/posts/${post.id}/status`, { action, revision: autosave.revision.current, ...extra });
      autosave.revision.current = updated.revision;
      setPost(updated);
      setFieldErrors({});
      if (action === 'discard') {
        editor?.commands.setContent(updated.content, { emitUpdate: false });
        setMeta(initialMeta(updated));
        autosave.markClean();
      }
      toast({
        publish: 'Published! Your article is live.', unpublish: 'Unpublished. The article is now a private draft.',
        update: 'Live article updated.', discard: 'Changes discarded.', schedule: `Scheduled for ${updated.scheduledAt ? formatDateTime(updated.scheduledAt) : 'later'}.`,
      }[action]);
      setDialog(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fields);
        toast(err.message, 'error');
      } else toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete this article?',
      message: <>“{meta.title || 'Untitled'}” will be permanently deleted{post.isLive ? ' and removed from the public blog' : ''}. This cannot be undone.</>,
      confirmLabel: 'Delete permanently', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/posts/${post.id}`);
      autosave.suspend();
      window.location.href = '/admin/blogs';
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function openPreview() {
    const win = window.open('about:blank', '_blank');
    const ok = await autosave.flush();
    if (!ok) {
      win?.close();
      toast(autosave.error?.message ?? 'Could not save before previewing.', 'error');
      return;
    }
    if (win) win.location.href = `/admin/preview/${post.id}`;
  }

  async function createCategory(name: string) {
    try {
      const created = await api.post<Category>('/api/admin/categories', { name });
      setCategories((c) => [...c, created].sort((a, b) => a.name.localeCompare(b.name)));
      patch({ categoryIds: [...meta.categoryIds, created.id] });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const dekRef = useRef<HTMLTextAreaElement>(null);
  const autosize = useCallback(() => {
    for (const el of [titleRef.current, dekRef.current]) {
      if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
    }
  }, []);
  useEffect(autosize, [meta.title, meta.excerpt, editor, focusMode, autosize]);
  useEffect(() => {
    // Re-measure once web fonts load and whenever the width changes.
    void document.fonts?.ready.then(autosize);
    window.addEventListener('resize', autosize);
    return () => window.removeEventListener('resize', autosize);
  }, [autosize]);

  const onTitleKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); dekRef.current?.focus(); }
  };

  const scheduled = post.status === 'scheduled' && !post.isLive;
  const publicUrl = `${siteUrl}/blogs/${post.slug}`;
  const slugError = meta.slug && !isValidSlug(meta.slug) ? 'Use lowercase letters, numbers and single hyphens.' : fieldErrors.slug;

  if (!editor) return <main className="admin-main" aria-busy="true">Loading editor…</main>;

  return (
    <div className="editor-shell">
      {confirmNode}
      <div className="editor-top">
        <a className="a-btn ghost sm" href="/admin/blogs">← Articles</a>
        <StatusBadge status={post.status} isLive={post.isLive} pending={post.hasPendingChanges} />
        <SaveIndicator state={autosave.state} lastSavedAt={autosave.lastSavedAt} error={autosave.error} live={post.isLive} />
        <span className="counts">{words.toLocaleString()} words · {readingMinutes(words)} min read</span>
        <span className="spacer" />
        <button type="button" className="a-btn sm side-toggle" aria-expanded={sideOpen} aria-controls="article-settings" onClick={() => setSideOpen((o) => !o)}>Settings</button>
        <button type="button" className="a-btn sm" onClick={openPreview}>Preview</button>
        {post.isLive && <a className="a-btn sm" href={publicUrl} target="_blank" rel="noopener">View live ↗</a>}
        <button type="button" className="a-btn sm" onClick={saveNow} disabled={autosave.state === 'saving'} title={`${MOD}+S`}>
          {post.isLive ? 'Save changes' : 'Save draft'}
        </button>
        {post.isLive ? (
          <>
            {post.hasPendingChanges && <button type="button" className="a-btn sm" disabled={!!busy} onClick={async () => {
              if (await confirm({ title: 'Discard unpublished changes?', message: 'The editor will go back to the version readers currently see.', confirmLabel: 'Discard changes', danger: true })) void statusAction('discard');
            }}>Discard changes</button>}
            <button type="button" className="a-btn sm" disabled={!!busy} onClick={() => statusAction('unpublish')}>{busy === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}</button>
            <button type="button" className="a-btn sm primary" disabled={!!busy || (!post.hasPendingChanges && autosave.state === 'saved')}
              onClick={() => statusAction('update')}>{busy === 'update' ? 'Updating…' : 'Update'}</button>
          </>
        ) : (
          <>
            {scheduled
              ? <button type="button" className="a-btn sm" disabled={!!busy} onClick={() => statusAction('unpublish')}>Unschedule</button>
              : <button type="button" className="a-btn sm" disabled={!!busy} onClick={() => setDialog('schedule')}>Schedule…</button>}
            <button type="button" className="a-btn sm primary" disabled={!!busy} onClick={() => statusAction('publish')}>
              {busy === 'publish' ? 'Publishing…' : scheduled ? 'Publish now' : 'Publish'}
            </button>
          </>
        )}
      </div>

      <div className={`editor-layout${focusMode ? ' focus' : ''}`}>
        <div className="writing">
          <div className="writing-inner">
            {autosave.state === 'conflict' && (
              <div className="banner error" role="alert">
                <span>This article was saved from another tab or device. Autosave is paused so nothing is overwritten.</span>
                <button type="button" className="a-btn sm" onClick={async () => {
                  if (await confirm({ title: 'Load the latest version?', message: 'Your unsaved edits in this tab will be lost.', confirmLabel: 'Load latest', danger: true })) {
                    autosave.suspend(); location.reload();
                  }
                }}>Load latest version</button>
                <button type="button" className="a-btn sm danger" onClick={async () => {
                  if (await confirm({ title: 'Overwrite with this version?', message: 'The other changes will be replaced by what you see here.', confirmLabel: 'Overwrite' })) {
                    if (await autosave.overwrite()) toast('Saved your version.');
                  }
                }}>Keep mine</button>
              </div>
            )}
            {post.isLive && post.hasPendingChanges && autosave.state !== 'conflict' && (
              <div className="banner warn">Readers still see the published version. Click <strong>Update</strong> to publish your changes.</div>
            )}
            {scheduled && post.scheduledAt && (
              <div className="banner info">Scheduled to publish {formatDateTime(post.scheduledAt)}. Edits save automatically and will be included.</div>
            )}
            {fieldErrors.content && <div className="banner error" role="alert">{fieldErrors.content}</div>}

            <label htmlFor="post-title" className="sr-only">Title</label>
            <textarea id="post-title" ref={titleRef} className="title-input" rows={1} placeholder="Article title" value={meta.title}
              maxLength={200} onKeyDown={onTitleKey} aria-invalid={!!fieldErrors.title}
              aria-describedby={fieldErrors.title ? 'title-err' : undefined}
              onChange={(e) => {
                const title = e.target.value.replace(/\n/g, ' ');
                patch({ title, ...(meta.slugAuto ? { slug: slugify(title) || meta.slug } : {}) });
              }} />
            {fieldErrors.title && <p className="field-error-inline" id="title-err">{fieldErrors.title}</p>}
            <label htmlFor="post-dek" className="sr-only">Subtitle or excerpt</label>
            <textarea id="post-dek" ref={dekRef} className="dek-input" rows={1} placeholder="Subtitle — a one or two sentence summary shown in listings"
              value={meta.excerpt} maxLength={500} onChange={(e) => patch({ excerpt: e.target.value })} />

            <div className="editor-chrome">
              <Toolbar editor={editor} onLink={() => setDialog('link')} onImage={() => setDialog('image')} onEmbed={() => setDialog('embed')}
                findOpen={findOpen} onToggleFind={() => setFindOpen((o) => !o)} focusMode={focusMode}
                onToggleFocus={() => setFocusMode((f) => !f)} onShortcuts={() => setDialog('shortcuts')} />
              {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
              <ContextBar editor={editor} />
            </div>
            <EditorContent editor={editor} />
          </div>
        </div>

        <aside id="article-settings" className={`side${sideOpen ? ' open' : ''}`} aria-label="Article settings">
          <h3>Publishing</h3>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            Created {formatDateTime(post.createdAt)}<br />
            Last updated {formatDateTime(post.updatedAt)}<br />
            {post.publishedAt && post.isLive && <>Published {formatDateTime(post.publishedAt)}<br /></>}
          </p>

          <h3>URL</h3>
          <div className="field">
            <label htmlFor="post-slug">Slug</label>
            <div className="slug-row">
              <input id="post-slug" className="input" value={meta.slug} maxLength={80} spellCheck={false}
                aria-invalid={!!slugError} aria-describedby="slug-help"
                onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/\s+/g, '-'), slugAuto: false })} />
              <button type="button" className="a-btn sm" title="Generate from title" aria-label="Generate slug from title"
                onClick={() => patch({ slug: slugify(meta.title) || meta.slug, slugAuto: true })}>↻</button>
            </div>
            <span className="slug-prefix" id="slug-help">{siteUrl.replace(/^https?:\/\//, '')}/blogs/{meta.slug || '…'}</span>
            {slugError && <span className="err">{slugError}</span>}
            {post.isLive && meta.slug !== initial.slug && <span className="hint">The old URL will redirect to the new one.</span>}
          </div>

          <h3>Cover image</h3>
          <div className="cover-box">
            {meta.coverImage ? (
              <>
                <img src={meta.coverImage.url} alt={meta.coverImage.alt} />
                {!meta.coverImage.alt && <p className="err" style={{ fontSize: 12.5, marginBottom: 6 }}>This image has no alt text — add it in Media.</p>}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  <button type="button" className="a-btn sm" onClick={() => setDialog('cover')}>Replace</button>
                  <button type="button" className="a-btn sm danger" onClick={() => patch({ coverImage: null })}>Remove</button>
                </div>
              </>
            ) : <button type="button" className="a-btn" onClick={() => setDialog('cover')}>Choose cover image</button>}
          </div>

          <h3>Categories</h3>
          <div className="cat-list" role="group" aria-label="Categories">
            {categories.length === 0 && <span className="hint">No categories yet.</span>}
            {categories.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={meta.categoryIds.includes(c.id)}
                  onChange={(e) => patch({ categoryIds: e.target.checked ? [...meta.categoryIds, c.id] : meta.categoryIds.filter((x) => x !== c.id) })} />
                {c.name}
              </label>
            ))}
          </div>
          <NewCategory onCreate={createCategory} />

          <h3>Tags</h3>
          <TagInput tags={meta.tags} onChange={(tags) => patch({ tags })} />

          <h3>Author & display</h3>
          <div className="field">
            <label htmlFor="post-author">Author</label>
            <input id="post-author" className="input" value={meta.authorName} maxLength={100} onChange={(e) => patch({ authorName: e.target.value })}
              aria-invalid={!!fieldErrors.authorName} />
            {fieldErrors.authorName && <span className="err">{fieldErrors.authorName}</span>}
          </div>
          <label className="check"><input type="checkbox" checked={meta.featured} onChange={(e) => patch({ featured: e.target.checked })} /> Feature at the top of the blog</label>

          <h3>Search & social</h3>
          <div className="field">
            <label htmlFor="seo-title">SEO title</label>
            <input id="seo-title" className="input" value={meta.seoTitle} maxLength={120} placeholder={meta.title || 'Defaults to the article title'}
              onChange={(e) => patch({ seoTitle: e.target.value })} />
            <span className={`counter${(meta.seoTitle || meta.title).length > 60 ? ' over' : ''}`}>{(meta.seoTitle || meta.title).length}/60</span>
          </div>
          <div className="field">
            <label htmlFor="seo-desc">SEO description</label>
            <textarea id="seo-desc" className="textarea" value={meta.seoDescription} maxLength={320} placeholder={meta.excerpt || 'Defaults to the subtitle'}
              onChange={(e) => patch({ seoDescription: e.target.value })} />
            <span className={`counter${(meta.seoDescription || meta.excerpt).length > 160 ? ' over' : ''}`}>{(meta.seoDescription || meta.excerpt).length}/160</span>
          </div>
          <div className="serp" aria-label="Search result preview">
            <div className="u">{siteUrl.replace(/^https?:\/\//, '')} › blogs › {meta.slug}</div>
            <div className="t">{(meta.seoTitle || meta.title || 'Article title').slice(0, 60)}</div>
            <div className="d">{(meta.seoDescription || meta.excerpt || 'Add a subtitle or SEO description to control this snippet.').slice(0, 160)}</div>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <span className="label">Social sharing image</span>
            {meta.ogImage
              ? <div className="cover-box"><img src={meta.ogImage.url} alt={meta.ogImage.alt} />
                  <button type="button" className="a-btn sm danger" onClick={() => patch({ ogImage: null })}>Remove</button></div>
              : <button type="button" className="a-btn sm" onClick={() => setDialog('og')}>Choose image (defaults to cover)</button>}
          </div>

          <h3>Danger zone</h3>
          <button type="button" className="a-btn danger" onClick={remove}>Delete article</button>
        </aside>
      </div>

      <LinkDialog editor={editor} open={dialog === 'link'} onClose={() => setDialog(null)} />
      <EmbedDialog editor={editor} open={dialog === 'embed'} onClose={() => setDialog(null)} />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
      <ScheduleDialog open={dialog === 'schedule'} onClose={() => setDialog(null)} busy={busy === 'schedule'}
        onSchedule={(at) => statusAction('schedule', { at })} />
      <Modal open={dialog === 'image' || dialog === 'cover' || dialog === 'og'} onClose={() => setDialog(null)} wide
        title={dialog === 'cover' ? 'Choose cover image' : dialog === 'og' ? 'Choose social sharing image' : 'Insert image'}>
        <MediaLibrary mode="pick" onPick={(asset) => {
          if (dialog === 'cover') patch({ coverImage: assetToRef(asset) });
          else if (dialog === 'og') patch({ ogImage: assetToRef(asset) });
          else editor.chain().focus().insertFigureImage({ src: asset.url, alt: asset.altText, caption: asset.caption, mediaId: asset.id }).run();
          setDialog(null);
        }} />
      </Modal>
    </div>
  );
}

function NewCategory({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  return (
    <form style={{ display: 'flex', gap: 6, marginTop: 10 }} onSubmit={async (e) => {
      e.preventDefault();
      if (!name.trim()) return;
      await onCreate(name.trim());
      setName('');
    }}>
      <label htmlFor="new-cat" className="sr-only">New category</label>
      <input id="new-cat" className="input" placeholder="New category" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="a-btn sm">Add</button>
    </form>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState('');
  const add = () => {
    const parts = value.split(',').map((t) => t.trim()).filter(Boolean);
    const next = [...tags];
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase()) && next.length < 20) next.push(p.slice(0, 40));
    onChange(next);
    setValue('');
  };
  return (
    <div className="tag-input">
      {tags.map((t) => (
        <span key={t} className="tag">{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button></span>
      ))}
      <label htmlFor="tag-entry" className="sr-only">Add tags</label>
      <input id="tag-entry" value={value} placeholder={tags.length ? '' : 'Add tags, press Enter'} onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() && add()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          else if (e.key === 'Backspace' && !value && tags.length) onChange(tags.slice(0, -1));
        }} />
    </div>
  );
}
