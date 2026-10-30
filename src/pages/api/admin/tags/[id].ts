import { NotFoundError } from '../../../../server/errors.ts';
import { route } from '../../../../server/http.ts';

export const DELETE = route(async (ctx, { taxonomy }) => {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new NotFoundError('Tag');
  await taxonomy.deleteTag(id);
  return new Response(null, { status: 204 });
});
