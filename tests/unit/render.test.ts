import { describe, expect, it } from 'vitest';
import { renderDocument, sanitizeArticleHtml } from '../../src/server/content/render.ts';
import { ValidationError } from '../../src/server/errors.ts';

const SITE = 'https://cynja.in';
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });

describe('renderDocument', () => {
  it('renders headings, marks, lists, quotes and rules', () => {
    const { html, wordCount, readingMinutes } = renderDocument(doc(
      { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [t('Clear feedback')] },
      p(t('Bold', [{ type: 'bold' }]), t(' and '), t('italic', [{ type: 'italic' }]), t(' and '),
        t('under', [{ type: 'underline' }]), t(' '), t('gone', [{ type: 'strike' }])),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('One')), {
        type: 'orderedList', content: [{ type: 'listItem', content: [p(t('Nested'))] }],
      }] }] },
      { type: 'blockquote', content: [p(t('A quote'))] },
      { type: 'horizontalRule' },
    ), SITE);
    expect(html).toContain('<h2 style="text-align:center">Clear feedback</h2>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<u>under</u>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toMatch(/<ul><li><p>One<\/p><ol><li><p>Nested<\/p><\/li><\/ol><\/li><\/ul>/);
    expect(html).toContain('<blockquote><p>A quote</p></blockquote>');
    expect(html).toContain('<hr');
    expect(wordCount).toBe(12);
    expect(readingMinutes).toBe(1);
  });

  it('marks external links safely and keeps internal links plain', () => {
    const { html } = renderDocument(doc(p(
      t('ext', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]), t(' '),
      t('int', [{ type: 'link', attrs: { href: '/blogs/other' } }]),
    )), SITE);
    expect(html).toContain('<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">ext</a>');
    expect(html).toContain('<a href="/blogs/other">int</a>');
  });

  it('drops javascript: links', () => {
    const { html } = renderDocument(doc(p(t('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))), SITE);
    expect(html).not.toMatch(/javascript/i);
    expect(html).not.toContain('<a');
  });

  it('renders images as figures with caption and alt text', () => {
    const { html } = renderDocument(doc({ type: 'figureImage', attrs: {
      src: '/media/2026/10/abc.webp', alt: 'Workshop', caption: 'Day one', width: 75, align: 'left',
    } }), SITE);
    expect(html).toContain('class="fig fig-left w-75"');
    expect(html).toContain('<img src="/media/2026/10/abc.webp" alt="Workshop" loading="lazy" decoding="async" />');
    expect(html).toContain('<figcaption>Day one</figcaption>');
  });

  it('renders allowlisted embeds from provider + id only', () => {
    const { html } = renderDocument(doc({ type: 'embed', attrs: { provider: 'youtube', id: 'dQw4w9WgXcQ', title: 'Talk' } }), SITE);
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('title="Talk"');
  });

  it('refuses embeds that are not on the allowlist', () => {
    const { html } = renderDocument(doc({ type: 'embed', attrs: { provider: 'evil', id: 'x' } }), SITE);
    expect(html).not.toContain('<iframe');
  });

  it('renders tables', () => {
    const cell = (type: string, text: string) => ({ type, content: [p(t(text))] });
    const { html } = renderDocument(doc({ type: 'table', content: [
      { type: 'tableRow', content: [cell('tableHeader', 'Skill'), cell('tableHeader', 'Level')] },
      { type: 'tableRow', content: [cell('tableCell', 'Excel'), cell('tableCell', 'Advanced')] },
    ] }), SITE);
    expect(html).toMatch(/<table>.*<th[^>]*><p>Skill<\/p><\/th>.*<td[^>]*><p>Advanced<\/p><\/td>.*<\/table>/s);
  });

  it('highlights code blocks with a known language and escapes content', () => {
    const { html } = renderDocument(doc({ type: 'codeBlock', attrs: { language: 'js' }, content: [t('const a = "<b>";')] }), SITE);
    expect(html).toContain('<pre><code class="language-js hljs">');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('rejects documents with unknown node types', () => {
    expect(() => renderDocument(doc({ type: 'script', content: [t('alert(1)')] }), SITE)).toThrow(ValidationError);
    expect(() => renderDocument({ type: 'nope' }, SITE)).toThrow(ValidationError);
  });

  it('treats injected HTML in text as text', () => {
    const { html } = renderDocument(doc(p(t('<img src=x onerror=alert(1)><script>alert(1)</script>'))), SITE);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('sanitizeArticleHtml', () => {
  it('strips scripts, event handlers and foreign iframes', () => {
    const dirty = '<p onclick="x()">Hi<script>alert(1)</script></p><iframe src="https://evil.example/x"></iframe>'
      + '<img src="javascript:alert(1)" alt="a"><a href="data:text/html,hi">d</a><svg><g/></svg>'
      + '<p style="color:red;text-align:right">s</p>';
    const clean = sanitizeArticleHtml(dirty, SITE);
    expect(clean).not.toMatch(/script|onclick|evil|javascript|data:|svg|color/);
    expect(clean).toContain('<p style="text-align:right">s</p>');
  });

  it('keeps iframes from allowed hosts', () => {
    const clean = sanitizeArticleHtml('<iframe src="https://player.vimeo.com/video/123456" title="v"></iframe>', SITE);
    expect(clean).toContain('<iframe src="https://player.vimeo.com/video/123456"');
  });
});
