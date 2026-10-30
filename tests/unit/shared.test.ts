import { describe, expect, it } from 'vitest';
import { embedSrc, parseEmbedUrl } from '../../src/shared/embeds.ts';
import { isExternalHref, normalizeHref } from '../../src/shared/links.ts';
import { countWords, isValidSlug, readingMinutes, slugify } from '../../src/shared/text.ts';

describe('slugify', () => {
  it.each([
    ['Hello, World!', 'hello-world'],
    ['  Résumé tips & tricks  ', 'resume-tips-and-tricks'],
    ['5 Phrases That Defuse Tension', '5-phrases-that-defuse-tension'],
    ['---', ''],
  ])('%s -> %s', (input, expected) => expect(slugify(input)).toBe(expected));

  it('caps length at a word boundary', () => {
    const slug = slugify('word '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });

  it('validates slugs', () => {
    expect(isValidSlug('good-slug-2')).toBe(true);
    expect(isValidSlug('Bad')).toBe(false);
    expect(isValidSlug('double--dash')).toBe(false);
    expect(isValidSlug('')).toBe(false);
  });
});

describe('reading time', () => {
  it('counts words and rounds minutes up', () => {
    expect(countWords("It's a well-known fact — 42 times.")).toBe(6);
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(226)).toBe(2);
  });
});

describe('normalizeHref', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['https://cynja.in/blogs', 'https://cynja.in/blogs'],
    ['/blogs/x', '/blogs/x'],
    ['#section-2', '#section-2'],
    ['mailto:hi@example.com', 'mailto:hi@example.com'],
    ['javascript:alert(1)', null],
    ['java\tscript:alert(1)', null],
    ['data:text/html,x', null],
    ['//evil.com', null],
    ['not a url', null],
    ['https://localhost', 'https://localhost/'],
  ])('%s', (input, expected) => expect(normalizeHref(input)).toBe(expected));

  it('detects external links', () => {
    expect(isExternalHref('https://other.com', 'https://cynja.in')).toBe(true);
    expect(isExternalHref('https://cynja.in/a', 'https://cynja.in')).toBe(false);
    expect(isExternalHref('/a', 'https://cynja.in')).toBe(false);
  });
});

describe('parseEmbedUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=3', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://www.loom.com/share/0123456789abcdef0123456789abcdef', 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef'],
    ['https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk', 'https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk'],
  ])('%s', (input, src) => {
    const ref = parseEmbedUrl(input);
    expect(ref).not.toBeNull();
    expect(embedSrc(ref!)).toBe(src);
  });

  it.each(['https://evil.com/embed/x', 'javascript:alert(1)', 'https://youtube.com/watch?v=<script>', 'nonsense'])(
    'rejects %s', (input) => expect(parseEmbedUrl(input)).toBeNull(),
  );
});
