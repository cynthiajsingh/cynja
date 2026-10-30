import { z } from 'zod';
import { setSessionCookie } from '../../../server/auth/cookies.ts';
import { clientIp, json, readJson, route } from '../../../server/http.ts';

const schema = z.object({
  username: z.string().trim().min(1, 'Enter your username.').max(40),
  password: z.string().min(1, 'Enter your password.').max(256),
});

export const POST = route(async (ctx, { auth }) => {
  const input = schema.parse(await readJson(ctx.request, 10_000));
  // Rotate: a fresh session id is issued on every successful login.
  const previous = ctx.locals.session;
  const session = await auth.login({
    username: input.username,
    password: input.password,
    ip: clientIp(ctx),
    userAgent: ctx.request.headers.get('user-agent') ?? '',
  });
  if (previous) await auth.logout(previous.sessionId);
  setSessionCookie(ctx.cookies, session.token, session.expiresAt);
  return json({ ok: true });
});
