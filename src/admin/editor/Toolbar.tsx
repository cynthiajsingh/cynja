import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IMAGE_ALIGNS, IMAGE_WIDTHS, type ImageAlign } from '../../shared/editor/nodes.ts';
import { searchKey } from './searchReplace.ts';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

function Btn({ label, shortcut, active, disabled, onClick, children }: {
  label: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" className="tb" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active === undefined ? undefined : active} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

const Sep = () => <span className="sep" aria-hidden="true" />;

export const CODE_LANGUAGES: [string, string][] = [
  ['', 'Plain text'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['python', 'Python'],
  ['xml', 'HTML / XML'], ['css', 'CSS'], ['json', 'JSON'], ['bash', 'Shell'], ['sql', 'SQL'],
  ['java', 'Java'], ['csharp', 'C#'], ['php', 'PHP'], ['go', 'Go'], ['yaml', 'YAML'], ['markdown', 'Markdown'],
];

export function Toolbar({ editor, onLink, onImage, onEmbed, findOpen, onToggleFind, focusMode, onToggleFocus, onShortcuts }: {
  editor: Editor; onLink: () => void; onImage: () => void; onEmbed: () => void;
  findOpen: boolean; onToggleFind: () => void; focusMode: boolean; onToggleFocus: () => void; onShortcuts: () => void;
}) {
  const c = () => editor.chain().focus();
  const block = editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3'
    : editor.isActive('heading', { level: 4 }) ? 'h4' : editor.isActive('paragraph') ? 'p' : '';
  const inList = editor.isActive('bulletList') || editor.isActive('orderedList');

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn label="Undo" shortcut={`${MOD}+Z`} disabled={!editor.can().undo()} onClick={() => c().undo().run()}>↶</Btn>
      <Btn label="Redo" shortcut={`${MOD}+Shift+Z`} disabled={!editor.can().redo()} onClick={() => c().redo().run()}>↷</Btn>
      <Sep />
      <span className="tb select">
        <label htmlFor="block-type" className="sr-only">Text style</label>
        <select id="block-type" value={block} onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') c().setParagraph().run();
          else c().setHeading({ level: Number(v.slice(1)) as 2 | 3 | 4 }).run();
        }}>
          {block === '' && <option value="">—</option>}
          <option value="p">Paragraph</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
        </select>
      </span>
      <Sep />
      <Btn label="Bold" shortcut={`${MOD}+B`} active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}><b>B</b></Btn>
      <Btn label="Italic" shortcut={`${MOD}+I`} active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}><i>I</i></Btn>
      <Btn label="Underline" shortcut={`${MOD}+U`} active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}><u>U</u></Btn>
      <Btn label="Strikethrough" shortcut={`${MOD}+Shift+S`} active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}><s>S</s></Btn>
      <Btn label="Inline code" shortcut={`${MOD}+E`} active={editor.isActive('code')} onClick={() => c().toggleCode().run()}>{'</>'}</Btn>
      <Btn label="Link" shortcut={`${MOD}+K`} active={editor.isActive('link')} onClick={onLink}>🔗</Btn>
      <Sep />
      <Btn label="Align left" shortcut={`${MOD}+Shift+L`} active={editor.isActive({ textAlign: 'left' })} onClick={() => c().setTextAlign('left').run()}>⯇</Btn>
      <Btn label="Align center" shortcut={`${MOD}+Shift+E`} active={editor.isActive({ textAlign: 'center' })} onClick={() => c().setTextAlign('center').run()}>≡</Btn>
      <Btn label="Align right" shortcut={`${MOD}+Shift+R`} active={editor.isActive({ textAlign: 'right' })} onClick={() => c().setTextAlign('right').run()}>⯈</Btn>
      <Btn label="Justify" shortcut={`${MOD}+Shift+J`} active={editor.isActive({ textAlign: 'justify' })} onClick={() => c().setTextAlign('justify').run()}>☰</Btn>
      <Sep />
      <Btn label="Bulleted list" shortcut={`${MOD}+Shift+8`} active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}>• ≡</Btn>
      <Btn label="Numbered list" shortcut={`${MOD}+Shift+7`} active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>1.</Btn>
      <Btn label="Indent list item" shortcut="Tab" disabled={!inList || !editor.can().sinkListItem('listItem')} onClick={() => c().sinkListItem('listItem').run()}>⇥</Btn>
      <Btn label="Outdent list item" shortcut="Shift+Tab" disabled={!inList || !editor.can().liftListItem('listItem')} onClick={() => c().liftListItem('listItem').run()}>⇤</Btn>
      <Sep />
      <Btn label="Quote" shortcut={`${MOD}+Shift+B`} active={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()}>❝</Btn>
      <Btn label="Code block" shortcut={`${MOD}+Alt+C`} active={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()}>{'{ }'}</Btn>
      <Btn label="Divider" onClick={() => c().setHorizontalRule().run()}>―</Btn>
      <Sep />
      <Btn label="Insert image" onClick={onImage}>🖼</Btn>
      <Btn label="Embed video or audio" onClick={onEmbed}>▶</Btn>
      <Btn label="Insert table" disabled={editor.isActive('table')} onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</Btn>
      <Sep />
      <Btn label="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()}>⌫</Btn>
      <Btn label="Find and replace" shortcut={`${MOD}+F`} active={findOpen} onClick={onToggleFind}>🔍</Btn>
      <Btn label="Focus mode" active={focusMode} onClick={onToggleFocus}>◐</Btn>
      <Btn label="Keyboard shortcuts" onClick={onShortcuts}>?</Btn>
    </div>
  );
}

/** Contextual controls for the selected image, embed, table or code block. */
export function ContextBar({ editor }: { editor: Editor }) {
  if (editor.isActive('figureImage')) return <ImageBar editor={editor} />;
  if (editor.isActive('embed')) {
    const title = String(editor.getAttributes('embed').title ?? '');
    return (
      <div className="context-bar" role="group" aria-label="Embed options">
        <span className="label">Embed</span>
        <label className="sr-only" htmlFor="embed-title">Embed title</label>
        <input id="embed-title" className="input" placeholder="Title (for screen readers)" value={title}
          onChange={(e) => editor.chain().updateAttributes('embed', { title: e.target.value }).run()} />
        <button type="button" className="a-btn sm danger" onClick={() => editor.chain().focus().deleteSelection().run()}>Remove</button>
      </div>
    );
  }
  if (editor.isActive('table')) {
    const c = () => editor.chain().focus();
    return (
      <div className="context-bar" role="group" aria-label="Table options">
        <span className="label">Table</span>
        <button type="button" className="a-btn sm" onClick={() => c().addRowBefore().run()}>+ Row above</button>
        <button type="button" className="a-btn sm" onClick={() => c().addRowAfter().run()}>+ Row below</button>
        <button type="button" className="a-btn sm" onClick={() => c().addColumnBefore().run()}>+ Col left</button>
        <button type="button" className="a-btn sm" onClick={() => c().addColumnAfter().run()}>+ Col right</button>
        <button type="button" className="a-btn sm" onClick={() => c().deleteRow().run()}>− Row</button>
        <button type="button" className="a-btn sm" onClick={() => c().deleteColumn().run()}>− Col</button>
        <button type="button" className="a-btn sm" onClick={() => c().toggleHeaderRow().run()}>Header row</button>
        <button type="button" className="a-btn sm" disabled={!editor.can().mergeCells()} onClick={() => c().mergeCells().run()}>Merge</button>
        <button type="button" className="a-btn sm" disabled={!editor.can().splitCell()} onClick={() => c().splitCell().run()}>Split</button>
        <button type="button" className="a-btn sm danger" onClick={() => c().deleteTable().run()}>Delete table</button>
      </div>
    );
  }
  if (editor.isActive('codeBlock')) {
    const lang = String(editor.getAttributes('codeBlock').language ?? '');
    return (
      <div className="context-bar" role="group" aria-label="Code block options">
        <label className="label" htmlFor="code-lang">Language</label>
        <select id="code-lang" className="select" style={{ width: 'auto' }} value={lang}
          onChange={(e) => editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value || null }).run()}>
          {CODE_LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
    );
  }
  return null;
}

function ImageBar({ editor }: { editor: Editor }) {
  const attrs = editor.getAttributes('figureImage') as { alt?: string; caption?: string; width?: number; align?: ImageAlign };
  const set = (patch: Record<string, unknown>) => editor.chain().updateAttributes('figureImage', patch).run();
  return (
    <div className="context-bar" role="group" aria-label="Image options">
      <span className="label">Image</span>
      <label className="sr-only" htmlFor="img-alt">Alt text</label>
      <input id="img-alt" className="input" placeholder="Alt text (describe the image)" value={attrs.alt ?? ''}
        aria-invalid={!attrs.alt} onChange={(e) => set({ alt: e.target.value })} maxLength={300} />
      <label className="sr-only" htmlFor="img-cap">Caption</label>
      <input id="img-cap" className="input" placeholder="Caption (optional)" value={attrs.caption ?? ''}
        onChange={(e) => set({ caption: e.target.value })} maxLength={500} />
      <span role="group" aria-label="Width" style={{ display: 'inline-flex', gap: 2 }}>
        {IMAGE_WIDTHS.map((w) => (
          <button key={w} type="button" className="tb" aria-pressed={Number(attrs.width ?? 100) === w} onClick={() => set({ width: w })}>{w}%</button>
        ))}
      </span>
      <span role="group" aria-label="Alignment" style={{ display: 'inline-flex', gap: 2 }}>
        {IMAGE_ALIGNS.map((a) => (
          <button key={a} type="button" className="tb" aria-pressed={(attrs.align ?? 'center') === a} onClick={() => set({ align: a })}>
            {a[0]!.toUpperCase() + a.slice(1)}
          </button>
        ))}
      </span>
      <button type="button" className="a-btn sm danger" onClick={() => editor.chain().focus().deleteSelection().run()}>Remove</button>
      {!attrs.alt && <span className="err" style={{ color: '#a30d0d', fontWeight: 600 }}>Add alt text for accessibility.</span>}
    </div>
  );
}

export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const s = searchKey.getState(editor.state);
  const count = s?.matches.length ?? 0;

  useEffect(() => {
    input.current?.focus();
    return () => { editor.commands.clearSearch(); };
  }, [editor]);

  useEffect(() => { editor.commands.setSearch(term, caseSensitive); }, [term, caseSensitive, editor]);

  return (
    <div className="find-bar" role="search" aria-label="Find and replace"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); editor.commands.focus(); } }}>
      <label className="sr-only" htmlFor="find-term">Find</label>
      <input id="find-term" ref={input} className="input" placeholder="Find" value={term} onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor.commands.gotoMatch(e.shiftKey ? -1 : 1); } }} />
      <span className="count" aria-live="polite">{term ? (count ? `${(s?.current ?? 0) + 1} of ${count}` : 'No matches') : ''}</span>
      <button type="button" className="a-btn sm" disabled={!count} onClick={() => editor.commands.gotoMatch(-1)} aria-label="Previous match">↑</button>
      <button type="button" className="a-btn sm" disabled={!count} onClick={() => editor.commands.gotoMatch(1)} aria-label="Next match">↓</button>
      <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Match case</label>
      <label className="sr-only" htmlFor="replace-term">Replace with</label>
      <input id="replace-term" className="input" placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
      <button type="button" className="a-btn sm" disabled={!count} onClick={() => editor.commands.replaceCurrent(replacement)}>Replace</button>
      <button type="button" className="a-btn sm" disabled={!count} onClick={() => editor.commands.replaceAll(replacement)}>Replace all</button>
      <button type="button" className="a-btn sm ghost" onClick={onClose} aria-label="Close find and replace">✕</button>
    </div>
  );
}
