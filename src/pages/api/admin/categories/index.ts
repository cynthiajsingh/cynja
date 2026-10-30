import { json, readJson, route } from '../../../../server/http.ts';

export const GET = route(async (_ctx, { taxonomy }) => json(await taxonomy.listCategories()));

export const POST = route(async (ctx, { taxonomy }) =>
  json(await taxonomy.createCategory(await readJson(ctx.request, 10_000)), { status: 201 }));
