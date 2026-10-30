import type { APIContext, APIRoute } from 'astro';
import { ZodError } from 'zod';
import { getServices, type Services } from './container.ts';
import { DatabaseNotConfiguredError } from './db/index.ts';
import { AppError, ConflictError, RateLimitError, ValidationError } from './errors.ts';
import { zodFields } from './posts/service.ts';

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** Maps errors to safe JSON responses. Unexpected errors are logged, never echoed. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return json({ error: { code: 'validation_failed', message: 'Please fix the highlighted fields.', fields: zodFields(err) } }, { status: 422 });
  }
  if (err instanceof AppError) {
    const body: Record<string, unknown> = { code: err.code, message: err.message };
    if (err instanceof ValidationError) body.fields = err.fields;
    if (err instanceof ConflictError) body.details = err.details;
    const headers: HeadersInit = err instanceof RateLimitError ? { 'Retry-After': String(err.retryAfterSeconds) } : {};
    return json({ error: body }, { status: err.status, headers });
  }
  if (err instanceof DatabaseNotConfiguredError) {
    console.error('[api]', err.message);
    return json({ error: { code: 'not_configured', message: 'The blog database is not configured yet.' } }, { status: 503 });
  }
  console.error('[api] unexpected error', err);
  return json({ error: { code: 'server_error', message: 'Something went wrong on the server. Please try again.' } }, { status: 500 });
}

export class PayloadError extends AppError {}

/** Reads a JSON body, enforcing content type and size. */
export async function readJson(request: Request, maxBytes = 2_500_000): Promise<unknown> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    throw new PayloadError(415, 'Expected a JSON request body.', 'unsupported_media_type');
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new PayloadError(413, 'The request is too large.', 'payload_too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new PayloadError(400, 'The request body is not valid JSON.', 'bad_json');
  }
}

/** Wraps an API route with service lookup and uniform error handling. */
export function route(fn: (ctx: APIContext, services: Services) => Promise<Response>): APIRoute {
  return async (ctx) => {
    try {
      return await fn(ctx, await getServices());
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function clientIp(ctx: APIContext): string {
  const header = ctx.request.headers.get('x-nf-client-connection-ip');
  if (header) return header.trim();
  try {
    return ctx.clientAddress;
  } catch {
    return 'unknown';
  }
}
