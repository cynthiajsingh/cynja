import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/server/db/migrator.ts';
import type { Db } from '../../src/server/db/types.ts';
import { createTestDb } from '../helpers/db.ts';

describe('database migrations', () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db.close(); });

  it('creates every table', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual(expect.arrayContaining([
      'admins', 'categories', 'login_attempts', 'media_assets', 'post_categories',
      'post_slug_history', 'post_tags', 'posts', 'schema_migrations', 'sessions', 'settings', 'tags',
    ]));
  });

  it('is idempotent', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it('enforces slug format and uniqueness at the database level', async () => {
    const insert = (id: string, slug: string) => db.query(
      "INSERT INTO posts (id, slug, content, author_name) VALUES ($1, $2, '{}'::jsonb, 'A')", [id, slug],
    );
    await insert('00000000-0000-4000-8000-000000000001', 'hello-world');
    await expect(insert('00000000-0000-4000-8000-000000000002', 'hello-world')).rejects.toThrow();
    await expect(insert('00000000-0000-4000-8000-000000000003', 'Bad Slug!')).rejects.toThrow();
  });
});
