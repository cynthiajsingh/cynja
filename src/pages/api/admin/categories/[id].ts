import { NotFoundError } from '../../../../server/errors.ts';
import { json, readJson, route } from '../../../../server/http.ts';

const id = (raw: string | undefined) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new NotFoundError('Category');
  return n;
};

export const PATCH = route(async (ctx, { taxonomy }) =>
  json(await taxonomy.updateCategory(id(ctx.params.id), await readJson(ctx.request, 10_000))));

export const DELETE = route(async (ctx, { taxonomy }) => {
  await taxonomy.deleteCategory(id(ctx.params.id));
  return new Response(null, { status: 204 });
});
