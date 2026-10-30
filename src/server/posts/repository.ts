import type { JSONContent } from '@tiptap/core';
import type { Queryable } from '../db/types.ts';
import { mediaUrl } from '../media/service.ts';
import type {
  AdminListItem, AdminPost, ArticleView, ImageRef, Page, PostStatus, PostSummary, TaxonomyRef,
} from './types.ts';

/** SQL predicate: what visitors may see. Scheduled posts go live as soon as their time passes. */
export const IS_LIVE = `(p.status = 'published' OR (p.status = 'scheduled' AND p.published_at <= now()))`;

const IMAGE_JSON = (col: string) => `(SELECT json_build_object('id', m.id, 'key', m.storage_key, 'alt', m.alt_text,
  'width', m.width, 'height', m.height) FROM media_assets m WHERE m.id = p.${col})`;

const TAXONOMY_JSON = `
  COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) ORDER BY c.name)
    FROM post_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.post_id = p.id), '[]'::json) AS categories,
  COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'slug', t.slug) ORDER BY t.name)
    FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id), '[]'::json) AS tags`;

const FULL_SELECT = `SELECT p.id, p.title, p.slug, p.excerpt, p.content, p.content_html, p.content_text, p.word_count,
  p.reading_minutes, p.author_name, p.status, p.featured, p.seo_title, p.seo_description, p.created_at,
  p.updated_at, p.published_at, p.scheduled_at, p.revision, ${IS_LIVE} AS is_live,
  p.pending IS NOT NULL AS has_pending, p.pending_saved_at,
  ${IMAGE_JSON('cover_image_id')} AS cover, ${IMAGE_JSON('og_image_id')} AS og, ${TAXONOMY_JSON}
  FROM posts p`;

const SUMMARY_SELECT = `SELECT p.id, p.title, p.slug, p.excerpt, p.content_text, p.author_name, p.published_at,
  p.reading_minutes, p.featured, ${IMAGE_JSON('cover_image_id')} AS cover, ${TAXONOMY_JSON}, count(*) OVER() AS total
  FROM posts p`;

interface ImageJson { id: string; key: string; alt: string; width: number | null; height: number | null }

interface FullRow {
  id: string; title: string; slug: string; excerpt: string; content: JSONContent; content_html: string;
  content_text: string; word_count: number; reading_minutes: number; author_name: string; status: PostStatus;
  featured: boolean; seo_title: string; seo_description: string; created_at: string; updated_at: string;
  published_at: string | null; scheduled_at: string | null; revision: number; is_live: boolean;
  has_pending: boolean; pending_saved_at: string | null; cover: ImageJson | null; og: ImageJson | null; categories: TaxonomyRef[]; tags: TaxonomyRef[];
}

interface SummaryRow {
  id: string; title: string; slug: string; excerpt: string; content_text: string; author_name: string;
  published_at: string; reading_minutes: number; featured: boolean; cover: ImageJson | null;
  categories: TaxonomyRef[]; tags: TaxonomyRef[]; total: number;
}

const parseJson = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

function image(v: unknown): ImageRef | null {
  const j = parseJson<ImageJson | null>(v);
  return j ? { id: j.id, url: mediaUrl(j.key), alt: j.alt, width: j.width, height: j.height } : null;
}

/** Listing excerpt: the author's excerpt, or the opening of the article. */
export function excerptOrLead(excerpt: string, text: string, max = 180): string {
  if (excerpt.trim()) return excerpt.trim();
  const lead = text.replace(/\s+/g, ' ').trim();
  if (lead.length <= max) return lead;
  return lead.slice(0, lead.lastIndexOf(' ', max)).replace(/[,;:.\-–—]+$/, '') + '…';
}

function toAdminPost(r: FullRow): AdminPost {
  return {
    id: r.id, title: r.title, slug: r.slug, excerpt: r.excerpt, content: parseJson(r.content),
    wordCount: r.word_count, readingMinutes: r.reading_minutes, coverImage: image(r.cover), ogImage: image(r.og),
    authorName: r.author_name, status: r.status, featured: r.featured, seoTitle: r.seo_title,
    seoDescription: r.seo_description, createdAt: r.created_at, updatedAt: r.updated_at,
    publishedAt: r.published_at, scheduledAt: r.scheduled_at, revision: r.revision,
    categories: parseJson(r.categories), tags: parseJson(r.tags), isLive: r.is_live,
    hasPendingChanges: r.has_pending, pendingSavedAt: r.pending_saved_at,
  };
}

function toArticle(r: FullRow): ArticleView {
  return {
    id: r.id, title: r.title, slug: r.slug, excerpt: excerptOrLead(r.excerpt, r.content_text),
    coverImage: image(r.cover), ogImage: image(r.og), authorName: r.author_name,
    publishedAt: r.published_at ?? r.updated_at, readingMinutes: r.reading_minutes, featured: r.featured,
    categories: parseJson(r.categories), tags: parseJson(r.tags), contentHtml: r.content_html,
    wordCount: r.word_count, updatedAt: r.updated_at, seoTitle: r.seo_title, seoDescription: r.seo_description,
  };
}

function toSummary(r: SummaryRow): PostSummary {
  return {
    id: r.id, title: r.title, slug: r.slug, excerpt: excerptOrLead(r.excerpt, r.content_text),
    coverImage: image(r.cover), authorName: r.author_name, publishedAt: r.published_at,
    readingMinutes: r.reading_minutes, featured: r.featured,
    categories: parseJson(r.categories), tags: parseJson(r.tags),
  };
}

function page<T>(items: T[], total: number, pageNo: number, pageSize: number): Page<T> {
  return { items, total, page: pageNo, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface PostWrite {
  title: string;
  slug: string;
  excerpt: string;
  content: JSONContent;
  contentHtml: string;
  contentText: string;
  wordCount: number;
  readingMinutes: number;
  coverImageId: string | null;
  ogImageId: string | null;
  authorName: string;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
}

export interface AdminListQuery {
  q?: string;
  status?: PostStatus;
  categoryId?: number;
  dateField: 'created' | 'updated' | 'published';
  from?: string;
  to?: string;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface PublicListQuery {
  q?: string;
  category?: string;
  tag?: string;
  page: number;
  pageSize: number;
}

/** All SQL for posts. Every value is passed as a parameter. */
export class PostRepository {
  constructor(private readonly db: Queryable) {}

  async insertDraft(id: string, slug: string, authorName: string, content: JSONContent): Promise<void> {
    await this.db.query(
      'INSERT INTO posts (id, slug, author_name, content) VALUES ($1, $2, $3, $4)',
      [id, slug, authorName, JSON.stringify(content)],
    );
  }

  async findById(id: string): Promise<AdminPost | null> {
    const { rows } = await this.db.query<FullRow>(`${FULL_SELECT} WHERE p.id = $1`, [id]);
    return rows[0] ? toAdminPost(rows[0]) : null;
  }

  async findArticleById(id: string): Promise<ArticleView | null> {
    const { rows } = await this.db.query<FullRow>(`${FULL_SELECT} WHERE p.id = $1`, [id]);
    return rows[0] ? toArticle(rows[0]) : null;
  }

  async findLiveBySlug(slug: string): Promise<ArticleView | null> {
    const { rows } = await this.db.query<FullRow>(`${FULL_SELECT} WHERE p.slug = $1 AND ${IS_LIVE}`, [slug]);
    return rows[0] ? toArticle(rows[0]) : null;
  }

  /** Current slug of a live post that used to be published under `oldSlug`. */
  async findRedirect(oldSlug: string): Promise<string | null> {
    const { rows } = await this.db.query<{ slug: string }>(
      `SELECT p.slug FROM post_slug_history h JOIN posts p ON p.id = h.post_id WHERE h.slug = $1 AND ${IS_LIVE}`,
      [oldSlug],
    );
    return rows[0]?.slug ?? null;
  }

  async slugOwner(slug: string): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>('SELECT id FROM posts WHERE slug = $1', [slug]);
    return rows[0]?.id ?? null;
  }

  /** Optimistic update: succeeds only if `revision` still matches. Returns the new revision or null. */
  async update(id: string, revision: number, w: PostWrite): Promise<number | null> {
    const { rows } = await this.db.query<{ revision: number }>(
      `UPDATE posts SET title = $3, slug = $4, excerpt = $5, content = $6, content_html = $7, content_text = $8,
         word_count = $9, reading_minutes = $10, cover_image_id = $11, og_image_id = $12, author_name = $13,
         featured = $14, seo_title = $15, seo_description = $16, updated_at = now(), revision = revision + 1,
         pending = NULL, pending_saved_at = NULL
       WHERE id = $1 AND revision = $2 RETURNING revision`,
      [id, revision, w.title, w.slug, w.excerpt, JSON.stringify(w.content), w.contentHtml, w.contentText,
        w.wordCount, w.readingMinutes, w.coverImageId, w.ogImageId, w.authorName, w.featured, w.seoTitle, w.seoDescription],
    );
    return rows[0]?.revision ?? null;
  }

  /** Stores autosaved edits of a live article without touching what readers see. */
  async savePending(id: string, revision: number, pending: unknown): Promise<number | null> {
    const { rows } = await this.db.query<{ revision: number }>(
      `UPDATE posts SET pending = $3, pending_saved_at = now(), revision = revision + 1
       WHERE id = $1 AND revision = $2 RETURNING revision`,
      [id, revision, JSON.stringify(pending)],
    );
    return rows[0]?.revision ?? null;
  }

  async findPending(id: string): Promise<unknown | null> {
    const { rows } = await this.db.query<{ pending: unknown }>('SELECT pending FROM posts WHERE id = $1', [id]);
    const value = rows[0]?.pending ?? null;
    return typeof value === 'string' ? JSON.parse(value) : value;
  }

  async clearPending(id: string, revision: number): Promise<number | null> {
    const { rows } = await this.db.query<{ revision: number }>(
      `UPDATE posts SET pending = NULL, pending_saved_at = NULL, revision = revision + 1
       WHERE id = $1 AND revision = $2 RETURNING revision`,
      [id, revision],
    );
    return rows[0]?.revision ?? null;
  }

  async rememberOldSlug(postId: string, oldSlug: string): Promise<void> {
    await this.db.query(
      `INSERT INTO post_slug_history (slug, post_id) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET post_id = EXCLUDED.post_id, created_at = now()`,
      [oldSlug, postId],
    );
  }

  /** A slug now in use by a post must no longer redirect elsewhere. */
  async releaseSlugHistory(slug: string): Promise<void> {
    await this.db.query('DELETE FROM post_slug_history WHERE slug = $1', [slug]);
  }

  /** `publishedAtSql` is one of the fixed expressions in PostService, never user input. */
  async setStatus(
    id: string, revision: number, status: PostStatus, publishedAtSql: string, scheduledAt: string | null,
  ): Promise<number | null> {
    const { rows } = await this.db.query<{ revision: number }>(
      `UPDATE posts p SET status = $3, published_at = ${publishedAtSql}, scheduled_at = $4,
         updated_at = now(), revision = revision + 1
       WHERE id = $1 AND revision = $2 RETURNING revision`,
      [id, revision, status, scheduledAt],
    );
    return rows[0]?.revision ?? null;
  }

  async setCategories(postId: string, categoryIds: number[]): Promise<void> {
    await this.db.query('DELETE FROM post_categories WHERE post_id = $1', [postId]);
    if (categoryIds.length) {
      await this.db.query(
        'INSERT INTO post_categories (post_id, category_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING',
        [postId, categoryIds],
      );
    }
  }

  async setTags(postId: string, tagIds: number[]): Promise<void> {
    await this.db.query('DELETE FROM post_tags WHERE post_id = $1', [postId]);
    if (tagIds.length) {
      await this.db.query(
        'INSERT INTO post_tags (post_id, tag_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING',
        [postId, tagIds],
      );
    }
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM posts WHERE id = $1', [id]);
    return res.rowCount > 0;
  }

  async listAdmin(q: AdminListQuery): Promise<Page<AdminListItem>> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
    if (q.q) {
      params.push(`%${q.q}%`, q.q);
      where.push(`(p.title ILIKE $${params.length - 1} OR p.search @@ websearch_to_tsquery('english', $${params.length}))`);
    }
    if (q.status) add('p.status = ?::post_status', q.status);
    if (q.categoryId) add('EXISTS (SELECT 1 FROM post_categories pc WHERE pc.post_id = p.id AND pc.category_id = ?)', q.categoryId);
    const col = { created: 'p.created_at', updated: 'p.updated_at', published: 'p.published_at' }[q.dateField];
    if (q.from) add(`${col} >= ?::timestamptz`, q.from);
    if (q.to) add(`${col} < (?::date + 1)`, q.to);
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const { rows } = await this.db.query<{
      id: string; title: string; slug: string; status: PostStatus; is_live: boolean; has_pending: boolean; featured: boolean;
      created_at: string; updated_at: string; published_at: string | null; scheduled_at: string | null;
      word_count: number; categories: TaxonomyRef[]; total: number;
    }>(
      `SELECT p.id, COALESCE(p.pending->>'title', p.title) AS title, p.slug, p.status, ${IS_LIVE} AS is_live,
         p.pending IS NOT NULL AS has_pending, p.featured, p.created_at, p.updated_at,
         p.published_at, p.scheduled_at, p.word_count,
         COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) ORDER BY c.name)
           FROM post_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.post_id = p.id), '[]'::json) AS categories,
         count(*) OVER() AS total
       FROM posts p ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${col} ${q.order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, p.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const items = rows.map((r) => ({
      id: r.id, title: r.title, slug: r.slug, status: r.status, isLive: r.is_live, hasPendingChanges: r.has_pending, featured: r.featured,
      createdAt: r.created_at, updatedAt: r.updated_at, publishedAt: r.published_at, scheduledAt: r.scheduled_at,
      wordCount: r.word_count, categories: parseJson<TaxonomyRef[]>(r.categories),
    }));
    return page(items, Number(rows[0]?.total ?? 0), q.page, q.pageSize);
  }

  async stats(): Promise<{ total: number; published: number; drafts: number; scheduled: number }> {
    const { rows } = await this.db.query<{ total: number; published: number; drafts: number; scheduled: number }>(
      `SELECT count(*) AS total,
         count(*) FILTER (WHERE ${IS_LIVE}) AS published,
         count(*) FILTER (WHERE p.status = 'draft') AS drafts,
         count(*) FILTER (WHERE p.status = 'scheduled' AND p.published_at > now()) AS scheduled
       FROM posts p`,
    );
    const r = rows[0]!;
    return { total: Number(r.total), published: Number(r.published), drafts: Number(r.drafts), scheduled: Number(r.scheduled) };
  }

  async listLive(q: PublicListQuery): Promise<Page<PostSummary>> {
    const where = [IS_LIVE];
    const params: unknown[] = [];
    if (q.q) {
      params.push(q.q, `%${q.q}%`);
      where.push(`(p.search @@ websearch_to_tsquery('english', $${params.length - 1}) OR p.title ILIKE $${params.length})`);
    }
    if (q.category) {
      params.push(q.category);
      where.push(`EXISTS (SELECT 1 FROM post_categories pc JOIN categories c ON c.id = pc.category_id
        WHERE pc.post_id = p.id AND c.slug = $${params.length})`);
    }
    if (q.tag) {
      params.push(q.tag);
      where.push(`EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.post_id = p.id AND t.slug = $${params.length})`);
    }
    const rank = q.q ? `ts_rank(p.search, websearch_to_tsquery('english', $1)) DESC,` : '';
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const { rows } = await this.db.query<SummaryRow>(
      `${SUMMARY_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY ${rank} p.published_at DESC, p.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return page(rows.map(toSummary), Number(rows[0]?.total ?? 0), q.page, q.pageSize);
  }

  async latestFeatured(): Promise<PostSummary | null> {
    const { rows } = await this.db.query<SummaryRow>(
      `${SUMMARY_SELECT} WHERE ${IS_LIVE} AND p.featured ORDER BY p.published_at DESC LIMIT 1`,
    );
    return rows[0] ? toSummary(rows[0]) : null;
  }

  /** Live posts sharing categories/tags, most overlap first, then most recent. */
  async related(postId: string, limit: number): Promise<PostSummary[]> {
    const { rows } = await this.db.query<SummaryRow>(
      `${SUMMARY_SELECT}
       LEFT JOIN LATERAL (
         SELECT (SELECT count(*) FROM post_categories a JOIN post_categories b ON a.category_id = b.category_id
                   WHERE a.post_id = p.id AND b.post_id = $1) * 2 +
                (SELECT count(*) FROM post_tags a JOIN post_tags b ON a.tag_id = b.tag_id
                   WHERE a.post_id = p.id AND b.post_id = $1) AS score
       ) s ON true
       WHERE ${IS_LIVE} AND p.id <> $1
       ORDER BY s.score DESC, p.published_at DESC LIMIT $2`,
      [postId, limit],
    );
    return rows.map(toSummary);
  }

  async adjacent(postId: string): Promise<{ previous: PostSummary | null; next: PostSummary | null }> {
    const run = async (cmp: '<' | '>', order: 'ASC' | 'DESC') => {
      const { rows } = await this.db.query<SummaryRow>(
        `${SUMMARY_SELECT} WHERE ${IS_LIVE} AND (p.published_at, p.id) ${cmp}
           (SELECT published_at, id FROM posts WHERE id = $1)
         ORDER BY p.published_at ${order}, p.id ${order} LIMIT 1`,
        [postId],
      );
      return rows[0] ? toSummary(rows[0]) : null;
    };
    const [previous, next] = await Promise.all([run('<', 'DESC'), run('>', 'ASC')]);
    return { previous, next };
  }

  async liveForSitemap(): Promise<{ slug: string; updatedAt: string }[]> {
    const { rows } = await this.db.query<{ slug: string; updated_at: string }>(
      `SELECT p.slug, p.updated_at FROM posts p WHERE ${IS_LIVE} ORDER BY p.published_at DESC`,
    );
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
  }

  async publishDue(): Promise<number> {
    const res = await this.db.query(
      `UPDATE posts SET status = 'published', scheduled_at = NULL
       WHERE status = 'scheduled' AND published_at <= now()`,
    );
    return res.rowCount;
  }
}
