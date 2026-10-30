import type { APIRoute } from 'astro';
import { getServices } from '../../server/container.ts';
import { MEDIA_KEY_PATTERN } from '../../server/media/storage.ts';

/** Serves uploaded images from durable storage. Keys are random and immutable, so cache forever. */
export const GET: APIRoute = async ({ params }) => {
  const key = params.key ?? '';
  if (!MEDIA_KEY_PATTERN.test(key)) return new Response('Not found', { status: 404 });
  try {
    const { media } = await getServices();
    const object = await media.read(key);
    if (!object || !object.contentType.startsWith('image/')) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(object.bytes), {
      headers: {
        'Content-Type': object.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline',
      },
    });
  } catch (err) {
    console.error('[media] read failed', key, err);
    return new Response('Media temporarily unavailable', { status: 503 });
  }
};
