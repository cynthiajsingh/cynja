import { z } from 'zod';
import { slugify } from '../../shared/text.ts';
import type { Db, Queryable } from '../db/types.ts';
import { NotFoundError, ValidationError } from '../errors.ts';
import { IS_LIVE } from '../posts/repository.ts';

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  postCount: number;
  liveCount: number;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  postCount: number;
}

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(60),
  description: z.string().trim().max(300).default(''),
});

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

export class TaxonomyService {
  constructor(private readonly db: Db) {}

  async listCategories(): Promise<Category[]> {
    const { rows } = await this.db.query<{
      id: number; name: string; slug: string; description: string; post_count: number; live_count: number;
    }>(
      `SELECT c.id, c.name, c.slug, c.description,
         (SELECT count(*) FROM post_categories pc WHERE pc.category_id = c.id) AS post_count,
         (SELECT count(*) FROM post_categories pc JOIN posts p ON p.id = pc.post_id
            WHERE pc.category_id = c.id AND ${IS_LIVE}) AS live_count
       FROM categories c ORDER BY c.name`,
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, description: r.description,
      postCount: Number(r.post_count), liveCount: Number(r.live_count),
    }));
  }

  /** Categories that have at least one live post, for public filters. */
  async liveCategories(): Promise<Category[]> {
    return (await this.listCategories()).filter((c) => c.liveCount > 0);
  }

  async createCategory(raw: unknown): Promise<Category> {
    const input = categoryInputSchema.parse(raw);
    const slug = slugify(input.name);
    if (!slug) throw new ValidationError({ name: 'Use at least one letter or number.' });
    try {
      await this.db.query('INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3)', [input.name, slug, input.description]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ValidationError({ name: 'A category with this name already exists.' });
      throw err;
    }
    return (await this.listCategories()).find((c) => c.slug === slug)!;
  }

  async updateCategory(id: number, raw: unknown): Promise<Category> {
    const input = categoryInputSchema.parse(raw);
    const slug = slugify(input.name);
    if (!slug) throw new ValidationError({ name: 'Use at least one letter or number.' });
    try {
      const res = await this.db.query('UPDATE categories SET name = $2, slug = $3, description = $4 WHERE id = $1', [id, input.name, slug, input.description]);
      if (!res.rowCount) throw new NotFoundError('Category');
    } catch (err) {
      if (isUniqueViolation(err)) throw new ValidationError({ name: 'A category with this name already exists.' });
      throw err;
    }
    return (await this.listCategories()).find((c) => c.id === id)!;
  }

  async deleteCategory(id: number): Promise<void> {
    const res = await this.db.query('DELETE FROM categories WHERE id = $1', [id]);
    if (!res.rowCount) throw new NotFoundError('Category');
  }

  async listTags(): Promise<Tag[]> {
    const { rows } = await this.db.query<{ id: number; name: string; slug: string; post_count: number }>(
      `SELECT t.id, t.name, t.slug, (SELECT count(*) FROM post_tags pt WHERE pt.tag_id = t.id) AS post_count
       FROM tags t ORDER BY t.name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, postCount: Number(r.post_count) }));
  }

  async deleteTag(id: number): Promise<void> {
    const res = await this.db.query('DELETE FROM tags WHERE id = $1', [id]);
    if (!res.rowCount) throw new NotFoundError('Tag');
  }

  async existingCategoryIds(tx: Queryable, ids: number[]): Promise<number[]> {
    if (!ids.length) return [];
    const { rows } = await tx.query<{ id: number }>('SELECT id FROM categories WHERE id = ANY($1::int[])', [ids]);
    if (rows.length !== new Set(ids).size) throw new ValidationError({ categoryIds: 'One of the selected categories no longer exists.' });
    return rows.map((r) => r.id);
  }

  /** Finds or creates tags by name (case-insensitive via slug) and returns their ids. */
  async upsertTags(tx: Queryable, names: string[]): Promise<number[]> {
    const bySlug = new Map<string, string>();
    for (const name of names) {
      const slug = slugify(name);
      if (slug && !bySlug.has(slug)) bySlug.set(slug, name.trim());
    }
    if (!bySlug.size) return [];
    const slugs = [...bySlug.keys()];
    await tx.query(
      `INSERT INTO tags (name, slug) SELECT n, s FROM unnest($1::text[], $2::text[]) AS x(n, s)
       ON CONFLICT DO NOTHING`,
      [slugs.map((s) => bySlug.get(s)!), slugs],
    );
    const { rows } = await tx.query<{ id: number }>('SELECT id FROM tags WHERE slug = ANY($1::text[])', [slugs]);
    return rows.map((r) => r.id);
  }
}
