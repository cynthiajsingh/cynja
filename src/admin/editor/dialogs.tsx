import type { Editor } from '@tiptap/react';
import { useEffect, useState, type FormEvent } from 'react';
import { EMBED_PROVIDERS, parseEmbedUrl, providerLabel } from '../../shared/embeds.ts';
import { normalizeHref } from '../../shared/links.ts';
import { Modal } from '../ui.tsx';
import { MOD } from './Toolbar.tsx';

export function LinkDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const hasSelection = !editor.state.selection.empty;
  const existing = editor.isActive('link');

  useEffect(() => {
    if (!open) return;
    setUrl(String(editor.getAttributes('link').href ?? ''));
    setText('');
    setError('');
  }, [open, editor]);

  function save(e: FormEvent) {
    e.preventDefault();
    const href = normalizeHref(url);
    if (!href) {
      setError('Enter a valid web address (https://…), email (mailto:…), phone (tel:…) or a page on this site (/…).');
      return;
    }
    const chain = editor.chain().focus();
    if (!hasSelection && !existing) {
      const label = text.trim() || href;
      chain.insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      chain.extendMarkRange('link').setLink({ href }).run();
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit link' : 'Add link'}>
      <form onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor="link-url">Link address</label>
          <input id="link-url" className="input" type="url" inputMode="url" placeholder="https://example.com" value={url}
            onChange={(e) => { setUrl(e.target.value); setError(''); }} aria-invalid={!!error}
            aria-describedby={error ? 'link-err' : 'link-hint'} autoFocus />
          {error ? <span className="err" id="link-err">{error}</span>
            : <span className="hint" id="link-hint">Links to other websites open in a new tab and are marked noopener.</span>}
        </div>
        {!hasSelection && !existing && (
          <div className="field">
            <label htmlFor="link-text">Text to display</label>
            <input id="link-text" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Defaults to the address" />
          </div>
        )}
        <div className="dialog-foot" style={{ padding: '8px 0 0' }}>
          {existing && (
            <button type="button" className="a-btn danger" style={{ marginRight: 'auto' }}
              onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); }}>Remove link</button>
          )}
          <button type="button" className="a-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="a-btn primary">{existing ? 'Update link' : 'Add link'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function EmbedDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setUrl(''); setTitle(''); setError(''); } }, [open]);
  const ref = url ? parseEmbedUrl(url) : null;

  function save(e: FormEvent) {
    e.preventDefault();
    if (!ref) {
      setError(`Paste a link from ${EMBED_PROVIDERS.map(providerLabel).join(', ')}.`);
      return;
    }
    editor.chain().focus().insertEmbed({ ...ref, title: title.trim() || `${providerLabel(ref.provider)} embed` }).run();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Embed video or audio">
      <form onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor="embed-url">Link</label>
          <input id="embed-url" className="input" type="url" placeholder="https://www.youtube.com/watch?v=…" value={url}
            onChange={(e) => { setUrl(e.target.value); setError(''); }} aria-invalid={!!error} autoFocus
            aria-describedby="embed-hint" />
          <span className="hint" id="embed-hint">
            {ref ? `✓ ${providerLabel(ref.provider)} recognised` : `Supported: ${EMBED_PROVIDERS.map(providerLabel).join(', ')}. Other sites are blocked for security.`}
          </span>
          {error && <span className="err">{error}</span>}
        </div>
        <div className="field">
          <label htmlFor="embed-title">Title</label>
          <input id="embed-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Describes the media for screen readers" />
        </div>
        <div className="dialog-foot" style={{ padding: '8px 0 0' }}>
          <button type="button" className="a-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="a-btn primary" disabled={!url}>Embed</button>
        </div>
      </form>
    </Modal>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleDialog({ open, onClose, onSchedule, busy }: {
  open: boolean; onClose: () => void; onSchedule: (iso: string) => void; busy: boolean;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setMinutes(0, 0, 0);
    d.setHours(9);
    setValue(toLocalInput(d));
    setError('');
  }, [open]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const when = new Date(value);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
      setError('Choose a date and time in the future.');
      return;
    }
    onSchedule(when.toISOString());
  }

  return (
    <Modal open={open} onClose={onClose} title="Schedule publication">
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="sched-at">Publish on</label>
          <input id="sched-at" className="input" type="datetime-local" value={value} min={toLocalInput(new Date())}
            onChange={(e) => { setValue(e.target.value); setError(''); }} aria-invalid={!!error} />
          <span className="hint">Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}). The article becomes visible automatically at this time.</span>
          {error && <span className="err">{error}</span>}
        </div>
        <div className="dialog-foot" style={{ padding: '8px 0 0' }}>
          <button type="button" className="a-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="a-btn primary" disabled={busy}>{busy ? 'Scheduling…' : 'Schedule'}</button>
        </div>
      </form>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Save now', `${MOD}+S`], ['Bold / Italic / Underline', `${MOD}+B / I / U`], ['Strikethrough', `${MOD}+Shift+S`],
  ['Inline code', `${MOD}+E`], ['Link', `${MOD}+K`], ['Heading 2 / 3 / 4', `${MOD}+Alt+2 / 3 / 4`],
  ['Paragraph', `${MOD}+Alt+0`], ['Bulleted / numbered list', `${MOD}+Shift+8 / 7`], ['Indent / outdent list', 'Tab / Shift+Tab'],
  ['Quote', `${MOD}+Shift+B`], ['Code block', `${MOD}+Alt+C`], ['Align left / center / right / justify', `${MOD}+Shift+L / E / R / J`],
  ['Undo / redo', `${MOD}+Z / ${MOD}+Shift+Z`], ['Find & replace', `${MOD}+F`], ['Next / previous match', 'Enter / Shift+Enter'],
  ['Exit focus mode or close bars', 'Esc'],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="shortcut-list">
        {SHORTCUTS.flatMap(([label, keys]) => [<span key={label}>{label}</span>, <span key={`${label}-k`} className="kbd">{keys}</span>])}
      </div>
    </Modal>
  );
}
