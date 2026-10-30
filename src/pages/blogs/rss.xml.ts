import type { APIRoute } from 'astro';
import { getServices } from '../../server/container.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? new URL('https://cynja.in');
  let items = '';
  try {
    const { posts } = await getServices();
    const latest = await posts.listPublic({ page: 1 });
    items = latest.items.map((p) => {
      const link = new URL(`/blogs/${p.slug}`, origin).href;
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
      <description>${esc(p.excerpt)}</description>
${p.categories.map((c) => `      <category>${esc(c.name)}</category>`).join('\n')}
    </item>`;
    }).join('\n');
  } catch (err) {
    console.error('[rss] could not load posts', err);
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Cynthia J Singh — Blog</title>
    <link>${new URL('/blogs', origin).href}</link>
    <atom:link href="${new URL('/blogs/rss.xml', origin).href}" rel="self" type="application/rss+xml" />
    <description>Articles on workplace behaviour, communication, leadership and learning.</description>
    <language>en-in</language>
${items}
  </channel>
</rss>`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' },
  });
};
