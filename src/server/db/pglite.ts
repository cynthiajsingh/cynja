// Embedded Postgres (WebAssembly) for local development and tests only.
// Production always uses a real Postgres via ./pg.ts.
import { mkdirSync } from 'node:fs';
import type { Db, Queryable, QueryResult } from './types.ts';

interface PGliteLike {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  transaction<T>(fn: (tx: { query: PGliteLike['query'] }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  return value;
}

function wrap(q: PGliteLike['query']): Queryable {
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
      const res = await q<Record<string, unknown>>(text, params as unknown[]);
      const rows = res.rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) out[k] = normalise(v);
        return out as T;
      });
      return { rows, rowCount: res.affectedRows ?? rows.length };
    },
  };
}

/** `dataDir` undefined = in-memory (tests); a path = persisted on disk (local dev). */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const moduleName = '@electric-sql/pglite';
  const { PGlite } = (await import(/* @vite-ignore */ moduleName)) as {
    PGlite: new (dir?: string) => PGliteLike;
  };
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const instance = new PGlite(dataDir);
  const base = wrap(instance.query.bind(instance));
  return {
    query: base.query,
    transaction: (fn) => instance.transaction((tx) => fn(wrap(tx.query.bind(tx)))),
    close: () => instance.close(),
  };
}
