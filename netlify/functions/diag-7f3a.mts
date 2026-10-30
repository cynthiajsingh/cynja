// TEMPORARY diagnostic: reports why the SSR bundle fails to load on Netlify. Remove after use.
export default async () => {
  const out: Record<string, unknown> = { node: process.version, runtime: process.env.AWS_EXECUTION_ENV ?? null };
  for (const mod of ['happy-dom', 'pg', '@tiptap/html/server', 'sanitize-html', 'lowlight', '@netlify/blobs']) {
    try {
      await import(mod);
      out[mod] = 'ok';
    } catch (err) {
      out[mod] = `${(err as Error).name}: ${(err as Error).message}`.slice(0, 300);
    }
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
};

export const config = { path: '/__diag-7f3a' };
