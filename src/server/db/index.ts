import path from 'node:path';
import { databaseUrl, isProduction, localDataDir } from '../config.ts';
import { createPgDb } from './pg.ts';
import type { Db } from './types.ts';

export type { Db, Queryable } from './types.ts';

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('The blog database is not configured. Set NETLIFY_DATABASE_URL (Netlify DB) or DATABASE_URL.');
  }
}

let dbPromise: Promise<Db> | undefined;

/** Process-wide database handle, created on first use. */
export function getDb(): Promise<Db> {
  dbPromise ??= openDb().catch((err) => {
    dbPromise = undefined;
    throw err;
  });
  return dbPromise;
}

async function openDb(): Promise<Db> {
  const url = databaseUrl();
  if (url) return createPgDb(url);
  if (isProduction()) throw new DatabaseNotConfiguredError();
  // Local development: persistent embedded Postgres, migrated on start.
  const { createPgliteDb } = await import('./pglite.ts');
  const { migrate } = await import('./migrator.ts');
  const db = await createPgliteDb(path.resolve(process.cwd(), localDataDir(), 'pglite'));
  await migrate(db, undefined, (m) => console.log(`[db] ${m}`));
  return db;
}
