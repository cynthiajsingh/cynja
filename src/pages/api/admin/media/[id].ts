import { z } from 'zod';
import { NotFoundError } from '../../../../server/errors.ts';
import { json, readJson, route } from '../../../../server/http.ts';

const id = (raw: string | undefined) => {
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) throw new NotFoundError('Image');
  return parsed.data;
};

const metaSchema = z.object({
  altText: z.string().trim().max(300),
  caption: z.string().trim().max(500),
});

export const GET = route(async (ctx, { media }) => {
  const assetId = id(ctx.params.id);
  return json({ ...(await media.get(assetId)), usedBy: await media.usage(assetId) });
});

export const PATCH = route(async (ctx, { media }) =>
  json(await media.updateMeta(id(ctx.params.id), metaSchema.parse(await readJson(ctx.request, 10_000)))));

export const DELETE = route(async (ctx, { media }) => {
  await media.delete(id(ctx.params.id));
  return new Response(null, { status: 204 });
});
