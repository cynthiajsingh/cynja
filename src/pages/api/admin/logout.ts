import { clearSessionCookie } from '../../../server/auth/cookies.ts';
import { json, route } from '../../../server/http.ts';

export const POST = route(async (ctx, { auth }) => {
  if (ctx.locals.session) await auth.logout(ctx.locals.session.sessionId);
  clearSessionCookie(ctx.cookies);
  return json({ ok: true });
});
