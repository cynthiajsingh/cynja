// Netlify Scheduled Function: flips due scheduled posts to "published" and
// cleans up expired sessions. Public pages already treat a scheduled post as
// live once its time has passed, so a late run never delays publication.
import { AuthService } from '../../src/server/auth/service.ts';
import { databaseUrl } from '../../src/server/config.ts';
import { createPgDb } from '../../src/server/db/pg.ts';
import { PostRepository } from '../../src/server/posts/repository.ts';

export default async () => {
  const url = databaseUrl();
  if (!url) {
    console.warn('[scheduler] database not configured; skipping');
    return;
  }
  const db = createPgDb(url);
  try {
    const published = await new PostRepository(db).publishDue();
    await new AuthService(db).purgeExpired();
    console.log(`[scheduler] published ${published} scheduled post(s)`);
  } finally {
    await db.close();
  }
};

export const config = {
  schedule: '*/10 * * * *',
};
