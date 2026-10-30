import { z } from 'zod';
import { setSessionCookie } from '../../../server/auth/cookies.ts';
import { csrfTokenFor } from '../../../server/auth/tokens.ts';
import { json, readJson, route } from '../../../server/http.ts';

const schema = z.object({
  current: z.string().min(1, 'Enter your current password.').max(256),
  next: z.string().max(256),
});

export const POST = route(async (ctx, { auth }) => {
  const input = schema.parse(await readJson(ctx.request, 10_000));
  const session = await auth.changePassword({
    adminId: ctx.locals.session!.admin.id,
    current: input.current,
    next: input.next,
    userAgent: ctx.request.headers.get('user-agent') ?? '',
  });
  setSessionCookie(ctx.cookies, session.token, session.expiresAt);
  // Every other session was signed out; this tab continues with a new CSRF token.
  return json({ ok: true, csrfToken: csrfTokenFor(session.sessionId) });
});
