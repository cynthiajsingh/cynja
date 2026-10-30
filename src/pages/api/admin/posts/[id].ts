import { z } from 'zod';
import { NotFoundError } from '../../../../server/errors.ts';
import { json, readJson, route } from '../../../../server/http.ts';

const id = (raw: string | undefined) => {
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) throw new NotFoundError('Article');
  return parsed.data;
};

export const GET = route(async (ctx, { posts }) => json(await posts.get(id(ctx.params.id))));

/** Save Draft / autosave / Update: full editor state with the revision it was based on. */
export const PUT = route(async (ctx, { posts }) => json(await posts.save(id(ctx.params.id), await readJson(ctx.request))));

export const DELETE = route(async (ctx, { posts }) => {
  await posts.delete(id(ctx.params.id));
  return new Response(null, { status: 204 });
});
