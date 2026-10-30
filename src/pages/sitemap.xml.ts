import type { APIRoute } from 'astro';
import { getServices } from '../server/container.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Homepage, blog index and every live article. Drafts and admin routes are never listed. */
export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? new URL('https://cynja.in');
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: new URL('/', origin).href },
    { loc: new URL('/blogs', origin).href },
  ];
  try {
    const { posts } = await getServices();
    for (const entry of await posts.sitemapEntries()) {
      urls.push({ loc: new URL(`/blogs/${entry.slug}`, origin).href, lastmod: entry.updatedAt });
    }
  } catch (err) {
    console.error('[sitemap] could not load posts', err);
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
