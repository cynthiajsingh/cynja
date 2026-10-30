import { databaseUrl } from '../src/server/config.ts';
import { migrate } from '../src/server/db/migrator.ts';
import { createPgDb } from '../src/server/db/pg.ts';

const db = createPgDb(databaseUrl()!);
try {
  const applied = await migrate(db, undefined, (m) => console.log(`[migrate] ${m}`));
  console.log(applied.length ? `[migrate] ${applied.length} migration(s) applied.` : '[migrate] Database is up to date.');
} catch (err) {
  console.error('[migrate] failed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
