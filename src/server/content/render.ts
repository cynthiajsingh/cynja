import { getSchema, type JSONContent } from '@tiptap/core';
import { generateHTML } from '@tiptap/html/server';
import { Node as PMNode } from '@tiptap/pm/model';
import { toHtml } from 'hast-util-to-html';
import sanitizeHtml from 'sanitize-html';
import { EMBED_HOSTS } from '../../shared/embeds.ts';
import { articleExtensions, lowlight } from '../../shared/editor/schema.ts';
import { isExternalHref, normalizeHref } from '../../shared/links.ts';
import { countWords, readingMinutes } from '../../shared/text.ts';
import { ValidationError } from '../errors.ts';

const extensions = articleExtensions();
const schema = getSchema(extensions);

export interface RenderedContent {
  /** The document normalised through the schema (unknown attributes dropped). */
  doc: JSONContent;
  html: string;
  text: string;
  wordCount: number;
  readingMinutes: number;
}

const MAX_DOC_BYTES = 2_000_000;

/** Validates editor JSON against the article schema. Throws ValidationError when malformed. */
export function parseDocument(doc: unknown): PMNode {
  if (!doc || typeof doc !== 'object' || (doc as JSONContent).type !== 'doc') {
    throw new ValidationError({ content: 'Content must be an editor document.' });
  }
  if (JSON.stringify(doc).length > MAX_DOC_BYTES) {
    throw new ValidationError({ content: 'This article is too large to save (over 2 MB of content).' });
  }
  try {
    const node = schema.nodeFromJSON(doc);
    node.check();
    return node;
  } catch (err) {
    throw new ValidationError({ content: `Content is not valid: ${(err as Error).message}` });
  }
}

export function renderDocument(doc: unknown, siteOrigin: string): RenderedContent {
  const node = parseDocument(doc);
  const text = node.textBetween(0, node.content.size, '\n\n', ' ').trim();
  const wordCount = countWords(text);
  const normalised = node.toJSON() as JSONContent;
  const rawHtml = generateHTML(normalised, extensions);
  const html = sanitizeArticleHtml(highlightCodeBlocks(rawHtml), siteOrigin);
  return { doc: normalised, html, text, wordCount, readingMinutes: readingMinutes(wordCount) };
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };

function highlightCodeBlocks(html: string): string {
  return html.replace(
    // The server DOM serializer adds xmlns attributes; the sanitizer removes them afterwards.
    /<pre[^>]*><code(?: class="language-([\w+#-]+)")?[^>]*>([\s\S]*?)<\/code><\/pre>/g,
    (whole, lang: string | undefined, escaped: string) => {
      if (!lang || !lowlight.registered(lang)) return whole;
      const code = escaped.replace(/&(?:lt|gt|amp|quot|#39|#x27);/g, (e) => ENTITIES[e] ?? e);
      const highlighted = toHtml(lowlight.highlight(lang, code));
      return `<pre><code class="language-${lang} hljs">${highlighted}</code></pre>`;
    },
  );
}

/**
 * Allowlist sanitizer: the last line of defence against stored XSS. Anything the
 * editor schema cannot produce is dropped, iframes are limited to the embed
 * providers, and links are re-validated.
 */
export function sanitizeArticleHtml(html: string, siteOrigin: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'h2', 'h3', 'h4', 'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'span', 'blockquote',
      'ul', 'ol', 'li', 'hr', 'a', 'figure', 'img', 'figcaption', 'iframe',
      'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'loading', 'decoding'],
      figure: ['class', 'data-type', 'data-width', 'data-align', 'data-media-id', 'data-provider', 'data-embed-id'],
      iframe: ['src', 'title', 'loading', 'allow', 'allowfullscreen', 'referrerpolicy', 'frameborder'],
      ol: ['start', 'type'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      p: ['style'],
      h2: ['style'], h3: ['style'], h4: ['style'],
      code: ['class'],
      span: ['class'],
    },
    allowedClasses: {
      figure: ['fig', 'fig-*', 'w-*', 'embed', 'embed-*'],
      code: ['language-*', 'hljs'],
      span: ['hljs-*'],
    },
    allowedStyles: {
      '*': { 'text-align': [/^(left|right|center|justify)$/] },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https', 'http'], iframe: ['https'] },
    allowProtocolRelative: false,
    allowedIframeHostnames: EMBED_HOSTS,
    allowIframeRelativeUrls: false,
    transformTags: {
      a: (tagName, attribs): { tagName: string; attribs: Record<string, string> } => {
        const href = attribs.href ? normalizeHref(attribs.href) : null;
        if (!href) return { tagName: 'span', attribs: {} };
        return isExternalHref(href, siteOrigin)
          ? { tagName, attribs: { href, target: '_blank', rel: 'noopener noreferrer' } }
          : { tagName, attribs: { href } };
      },
      img: (tagName, attribs): { tagName: string; attribs: Record<string, string> } => {
        const src = attribs.src ?? '';
        const ok = src.startsWith('/media/') || /^https:\/\//i.test(src);
        return { tagName, attribs: ok ? { ...attribs, loading: 'lazy', decoding: 'async' } : { alt: attribs.alt ?? '' } };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  });
}
