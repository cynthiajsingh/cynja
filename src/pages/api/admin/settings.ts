import { json, readJson, route } from '../../../server/http.ts';

export const GET = route(async (_ctx, { settings }) => json({ author: await settings.author() }));

export const PUT = route(async (ctx, { settings }) => {
  const body = (await readJson(ctx.request, 10_000)) as { author?: unknown };
  return json({ author: await settings.saveAuthor(body.author) });
});
