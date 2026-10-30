import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { formatDate } from '../lib/format.ts';
import type { MediaAsset } from '../server/media/service.ts';
import { api, ApiError, errorMessage } from './api.ts';
import { formatBytes, prepareImage } from './image.ts';
import { ToastProvider, useConfirm, useToast } from './ui.tsx';

interface Props {
  /** "pick" shows an Insert button and calls onPick; "page" is the standalone library. */
  mode: 'page' | 'pick';
  onPick?: (asset: MediaAsset) => void;
}

export async function uploadImage(file: File, altText = ''): Promise<MediaAsset> {
  const prepared = await prepareImage(file);
  const form = new FormData();
  form.append('file', prepared);
  form.append('altText', altText);
  return api.upload<MediaAsset>('/api/admin/media', form);
}

export function MediaLibrary({ mode, onPick }: Props) {
  const toast = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ items: MediaAsset[]; total: number }>(`/api/admin/media?page=${p}`);
      setItems((prev) => (p === 1 ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
      setPage(p);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(1); }, [load]);

  function select(asset: MediaAsset) {
    setSelected(asset);
    setAlt(asset.altText);
    setCaption(asset.caption);
  }

  async function upload(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name));
    if (!list.length) {
      toast('Choose JPEG, PNG, WebP, GIF or AVIF images.', 'error');
      return;
    }
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const asset = await uploadImage(file);
        setItems((prev) => [asset, ...prev]);
        setTotal((t) => t + 1);
        select(asset);
        toast(`Uploaded ${asset.originalName}.`);
      } catch (err) {
        toast(`${file.name}: ${errorMessage(err)}`, 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function saveMeta() {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await api.patch<MediaAsset>(`/api/admin/media/${selected.id}`, { altText: alt, caption });
      setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setSelected(updated);
      toast('Image details saved.');
      return updated;
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(asset: MediaAsset) {
    const ok = await confirm({
      title: 'Delete this image?',
      message: 'It will be removed from the media library and storage. Images used in articles cannot be deleted.',
      confirmLabel: 'Delete image',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/media/${asset.id}`);
      setItems((prev) => prev.filter((a) => a.id !== asset.id));
      setTotal((t) => t - 1);
      setSelected(null);
      toast('Image deleted.');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : errorMessage(err), 'error');
    }
  }

  async function insert() {
    if (!selected || !onPick) return;
    const dirty = alt !== selected.altText || caption !== selected.caption;
    const asset = dirty ? await saveMeta() : selected;
    if (asset) onPick(asset);
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  };

  return (
    <div>
      {confirmNode}
      <div className={`dropzone${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <p style={{ marginBottom: 10 }}>Drag images here, or</p>
        <button type="button" className="a-btn primary" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? `Uploading ${uploading}…` : 'Choose images'}
        </button>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden
          onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }} />
        <p className="hint" style={{ marginTop: 10, fontSize: 12.5 }}>JPEG, PNG, WebP, GIF or AVIF · large photos are resized to 2400px · max 4 MB after resizing</p>
      </div>

      {selected && (
        <section className="panel" style={{ padding: 16, marginBottom: 16 }} aria-label="Selected image">
          <div className="media-detail">
            <img src={selected.url} alt={selected.altText} />
            <div>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, wordBreak: 'break-all' }}>
                {selected.originalName}<br />
                {selected.width && selected.height ? `${selected.width}×${selected.height} · ` : ''}{formatBytes(selected.sizeBytes)} · {selected.mimeType.replace('image/', '').toUpperCase()} · {formatDate(selected.createdAt)}
              </p>
              <div className="field">
                <label htmlFor="m-alt">Alt text</label>
                <input id="m-alt" className="input" value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)} />
                <span className="hint">Describe the image for people using screen readers.</span>
              </div>
              <div className="field">
                <label htmlFor="m-cap">Default caption</label>
                <input id="m-cap" className="input" value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {mode === 'pick' && <button type="button" className="a-btn primary" onClick={insert} disabled={saving}>Use this image</button>}
                <button type="button" className="a-btn" onClick={saveMeta} disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button>
                <button type="button" className="a-btn" onClick={() => { void navigator.clipboard.writeText(new URL(selected.url, location.origin).href); toast('Image URL copied.'); }}>Copy URL</button>
                <button type="button" className="a-btn danger" onClick={() => remove(selected)}>Delete</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {error ? (
        <div className="empty" role="alert"><h3>Couldn't load media</h3><p>{error}</p>
          <button type="button" className="a-btn" onClick={() => load(1)}>Retry</button></div>
      ) : !loading && items.length === 0 ? (
        <div className="empty"><h3>No images yet</h3><p>Upload your first image above.</p></div>
      ) : (
        <>
          <div className="media-grid" role="list" aria-busy={loading}>
            {items.map((a) => (
              <button key={a.id} type="button" role="listitem" className="media-tile" aria-pressed={selected?.id === a.id}
                onClick={() => select(a)} onDoubleClick={() => { if (mode === 'pick') { select(a); onPick?.(a); } }}
                aria-label={`${a.altText || a.originalName}${a.altText ? '' : ' (no alt text)'}`}>
                <img src={a.url} alt="" loading="lazy" />
                <div className="m">{a.altText || <em>No alt text</em>}</div>
              </button>
            ))}
          </div>
          {items.length < total && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button type="button" className="a-btn" onClick={() => load(page + 1)} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Standalone /admin/media page. */
export default function MediaLibraryPage() {
  return (
    <ToastProvider>
      <main className="admin-main">
        <div className="page-head"><div><h1>Media library</h1><p>Images available to every article.</p></div></div>
        <MediaLibrary mode="page" />
      </main>
    </ToastProvider>
  );
}
