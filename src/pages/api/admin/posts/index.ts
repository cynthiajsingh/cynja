import { json, route } from '../../../../server/http.ts';
import { adminListQuerySchema } from '../../../../server/posts/schemas.ts';

export const GET = route(async (ctx, { posts }) => {
  const query = adminListQuerySchema.parse(Object.fromEntries(ctx.url.searchParams));
  return json(await posts.listAdmin(query));
});

/** Creates an empty draft and returns it; the client then opens the editor. */
export const POST = route(async (_ctx, { posts, settings }) => {
  const author = await settings.author();
  return json(await posts.createDraft(author.name), { status: 201 });
});
