import { json, route } from '../../../../server/http.ts';

export const GET = route(async (_ctx, { taxonomy }) => json(await taxonomy.listTags()));
