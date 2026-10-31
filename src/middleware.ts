import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE } from './server/auth/cookies.ts';
import { csrfTokenFor, verifyCsrfToken } from './server/auth/tokens.ts';
import { getServices } from './server/container.ts';
import { errorResponse, json } from './server/http.ts';

const EMBED_FRAMES = 'https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://open.spotify.com';

const ADMIN_CSP = [
  "default-src 'self'",
  // Astro's island hydration uses small inline scripts.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `frame-src ${EMBED_FRAMES}`,
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Public pages may only be framed by this site itself.
const PUBLIC_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  `frame-src ${EMBED_FRAMES}`,
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isSameOrigin(request: Request, origin: string): boolean {
  const header = request.headers.get('origin');
  if (header) return header === origin;
  // Browsers always send Origin on cross-site POSTs; fall back to Fetch Metadata.
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname, search, origin } = ctx.url;
  ctx.locals.session = null;

  // `astro dev` has no route for the static homepage at "/".
  if (import.meta.env.DEV && pathname === '/') return ctx.redirect('/index.html');

  const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/');
  const isAdminApi = pathname.startsWith('/api/admin/');

  if (!isAdminPage && !isAdminApi) {
    const res = await next();
    if (!res.headers.has('Content-Security-Policy') && (res.headers.get('content-type') ?? '').includes('text/html')) {
      res.headers.set('Content-Security-Policy', PUBLIC_CSP);
    }
    return res;
  }

  try {
    if (isAdminApi && !SAFE_METHODS.has(ctx.request.method) && !isSameOrigin(ctx.request, origin)) {
      return json({ error: { code: 'forbidden', message: 'Cross-site request blocked.' } }, { status: 403 });
    }

    const services = await getServices();
    const session = await services.auth.validateSession(ctx.cookies.get(SESSION_COOKIE)?.value);
    ctx.locals.session = session;
    if (session) ctx.locals.csrfToken = csrfTokenFor(session.sessionId);

    const isLoginRoute = pathname === '/admin/login' || pathname === '/api/admin/login';
    if (!session && !isLoginRoute) {
      if (isAdminApi) return json({ error: { code: 'unauthorized', message: 'Your session has ended. Please sign in again.' } }, { status: 401 });
      return ctx.redirect(`/admin/login?next=${encodeURIComponent(pathname + search)}`);
    }

    if (session && isAdminApi && !SAFE_METHODS.has(ctx.request.method)
      && !verifyCsrfToken(session.sessionId, ctx.request.headers.get('x-csrf-token'))) {
      return json({ error: { code: 'csrf_failed', message: 'Your session token is out of date. Reload the page and try again.' } }, { status: 403 });
    }

    const res = await next();
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('Referrer-Policy', 'same-origin');
    if ((res.headers.get('content-type') ?? '').includes('text/html')) res.headers.set('Content-Security-Policy', ADMIN_CSP);
    return res;
  } catch (err) {
    if (isAdminApi) return errorResponse(err);
    console.error('[admin] request failed', err);
    return new Response('The admin panel is unavailable: the blog database is not reachable or not configured.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' },
    });
  }
});
