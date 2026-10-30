// TEMPORARY diagnostic: reports why the SSR bundle fails on Netlify. Remove after use.
import { renderDocument } from '../../src/server/content/render.ts';
import { getServices } from '../../src/server/container.ts';

export default async () => {
  const out: Record<string, unknown> = { node: process.version, cwd: process.cwd() };
  try {
    out.render = renderDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }, 'https://cynja.in').html;
  } catch (err) {
    out.render = `${(err as Error).name}: ${(err as Error).message}`.slice(0, 400);
  }
  try {
    await getServices();
    out.services = 'ok';
  } catch (err) {
    out.services = `${(err as Error).name}: ${(err as Error).message}`.slice(0, 400);
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
};

export const config = { path: '/__diag-7f3a' };
