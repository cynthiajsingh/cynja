import type { AnyExtension, JSONContent } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { normalizeHref } from '../links.ts';
import { Embed, FigureImage } from './nodes.ts';

export const lowlight = createLowlight(common);

export const HEADING_LEVELS = [2, 3, 4] as const;

/**
 * The single source of truth for what an article can contain. The editor adds
 * UI-only extensions (placeholder, search & replace) on top of this list; the
 * server renders stored JSON with exactly this list.
 */
export function articleExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [...HEADING_LEVELS] },
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        isAllowedUri: (url) => normalizeHref(url) !== null,
        HTMLAttributes: { rel: null, target: null },
      },
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    TableKit.configure({ table: { resizable: false } }),
    FigureImage,
    Embed,
  ];
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
