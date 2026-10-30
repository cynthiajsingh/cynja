import { z } from 'zod';
import { NotFoundError } from '../../../../../server/errors.ts';
import { json, readJson, route } from '../../../../../server/http.ts';
import { statusActionSchema } from '../../../../../server/posts/schemas.ts';

/** Publish, unpublish or schedule. */
export const POST = route(async (ctx, { posts }) => {
  const id = z.string().uuid().safeParse(ctx.params.id);
  if (!id.success) throw new NotFoundError('Article');
  const action = statusActionSchema.parse(await readJson(ctx.request, 10_000));
  return json(await posts.changeStatus(id.data, action));
});
