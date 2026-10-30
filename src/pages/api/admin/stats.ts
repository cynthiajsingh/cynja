import { json, route } from '../../../server/http.ts';

export const GET = route(async (_ctx, { posts }) => {
  const [stats, recent] = await Promise.all([posts.stats(), posts.recentlyEdited(5)]);
  return json({ stats, recent: recent.items });
});
