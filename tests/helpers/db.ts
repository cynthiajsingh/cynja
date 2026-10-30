import { createPgliteDb } from '../../src/server/db/pglite.ts';
import { migrate } from '../../src/server/db/migrator.ts';
import type { Db } from '../../src/server/db/types.ts';

/** Fresh, fully migrated in-memory Postgres for one test file. */
export async function createTestDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrate(db);
  return db;
}
