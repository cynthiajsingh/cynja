import { randomBytes, randomUUID } from 'node:crypto';
import { EMPTY_DOC } from '../../shared/editor/schema.ts';
import { isValidSlug, slugify } from '../../shared/text.ts';
import { renderDocument, type RenderedContent } from '../content/render.ts';
import type { Db, Queryable } from '../db/types.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import { mediaUrl } from '../media/service.ts';
import type { TaxonomyService } from '../taxonomy/service.ts';
import { excerptOrLead, PostRepository, type AdminListQuery, type PublicListQuery } from './repository.ts';
import { postInputSchema, type PostInput, type StatusAction } from './schemas.ts';
import type { AdminListItem, AdminPost, ArticleView, ImageRef, Page, PostSummary } from './types.ts';

export const PUBLIC_PAGE_SIZE = 9;
export const ADMIN_PAGE_SIZE = 20;

/** Slug given to brand-new drafts until the author picks a title. */
const PLACEHOLDER_SLUG = /^untitled-[0-9a-f]{8}$/;

export function zodFields(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.map(String).join('.') || 'body'] ??= issue.message;
  return fields;
}

/**
 * Use cases for articles.
 *
 * Lifecycle: Draft → Preview → Publish → Update or Unpublish (plus Schedule).
 * Drafts are edited in place. Once an article is live, autosaves go to a
 * pending copy that readers never see until "Update" applies it.
 * Every write carries the revision it was based on; stale writes get a 409.
 */
export class PostService {
  constructor(
    private readonly db: Db,
    private readonly taxonomy: TaxonomyService,
    private readonly siteOrigin: string,
  ) {}

  private repo(q: Queryable = this.db) {
    return new PostRepository(q);
  }

  async createDraft(authorName: string): Promise<AdminPost> {
    const id = randomUUID();
    const slug = `untitled-${randomBytes(4).toString('hex')}`;
    await this.repo().insertDraft(id, slug, authorName, EMPTY_DOC);
    return this.get(id);
  }

  /** The editor's working copy: pending edits (if any) layered over the live version. */
  async get(id: string, q: Queryable = this.db): Promise<AdminPost> {
    const repo = this.repo(q);
    const post = await repo.findById(id);
    if (!post) throw new NotFoundError('Article');
    if (!post.hasPendingChanges) return post;
    const parsed = postInputSchema.safeParse({ ...(await repo.findPending(id) as object), revision: post.revision });
    if (!parsed.success) return post;
    const p = parsed.data;
    const [images, categories] = await Promise.all([
      this.imageRefs(q, [p.coverImageId, p.ogImageId]),
      this.categoryRefs(q, p.categoryIds),
    ]);
    return {
      ...post,
      title: p.title, slug: p.slug || post.slug, excerpt: p.excerpt, content: p.content as AdminPost['content'],
      authorName: p.authorName, featured: p.featured, seoTitle: p.seoTitle, seoDescription: p.seoDescription,
      coverImage: p.coverImageId ? images.get(p.coverImageId) ?? null : null,
      ogImage: p.ogImageId ? images.get(p.ogImageId) ?? null : null,
      categories,
      tags: p.tags.map((name) => ({ id: 0, name, slug: slugify(name) })),
    };
  }

  private async imageRefs(q: Queryable, ids: (string | null)[]): Promise<Map<string, ImageRef>> {
    const wanted = ids.filter((x): x is string => !!x);
    if (!wanted.length) return new Map();
    const { rows } = await q.query<{ id: string; storage_key: string; alt_text: string; width: number | null; height: number | null }>(
      'SELECT id, storage_key, alt_text, width, height FROM media_assets WHERE id = ANY($1::uuid[])', [wanted],
    );
    return new Map(rows.map((r) => [r.id, { id: r.id, url: mediaUrl(r.storage_key), alt: r.alt_text, width: r.width, height: r.height }]));
  }

  private async categoryRefs(q: Queryable, ids: number[]) {
    if (!ids.length) return [];
    const { rows } = await q.query<{ id: number; name: string; slug: string }>(
      'SELECT id, name, slug FROM categories WHERE id = ANY($1::int[]) ORDER BY name', [ids],
    );
    return rows;
  }

  /** Save Draft / autosave. Drafts change in place; live articles get a pending copy. */
  async save(id: string, raw: unknown): Promise<AdminPost> {
    const input = this.parseInput(raw);
    const rendered = renderDocument(input.content, this.siteOrigin);
    await this.db.transaction(async (tx) => {
      const repo = this.repo(tx);
      const current = await repo.findById(id);
      if (!current) throw new NotFoundError('Article');
      if (current.revision !== input.revision) throw this.staleError(current);
      const slug = await this.resolveSlug(repo, id, input, current.slug);
      await this.assertMediaExists(tx, [input.coverImageId, input.ogImageId]);
      await this.taxonomy.existingCategoryIds(tx, input.categoryIds);

      if (current.isLive) {
        const next = await repo.savePending(id, input.revision, { ...input, slug, content: rendered.doc });
        if (next === null) throw this.staleError(current);
      } else {
        await this.applyToLive(tx, current, input, slug, rendered);
      }
    });
    return this.get(id);
  }

  private parseInput(raw: unknown): PostInput {
    const parsed = postInputSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(zodFields(parsed.error));
    return parsed.data;
  }

  /** Writes the editor state to the columns readers see, clearing any pending copy. */
  private async applyToLive(
    tx: Queryable, current: AdminPost, input: PostInput, slug: string, rendered: RenderedContent,
  ): Promise<number> {
    const repo = this.repo(tx);
    const categoryIds = await this.taxonomy.existingCategoryIds(tx, input.categoryIds);
    const tagIds = await this.taxonomy.upsertTags(tx, input.tags);
    const next = await repo.update(current.id, current.revision, {
      title: input.title, slug, excerpt: input.excerpt, content: rendered.doc,
      contentHtml: rendered.html, contentText: rendered.text, wordCount: rendered.wordCount,
      readingMinutes: rendered.readingMinutes, coverImageId: input.coverImageId, ogImageId: input.ogImageId,
      authorName: input.authorName, featured: input.featured, seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
    });
    if (next === null) throw this.staleError(current);
    await repo.setCategories(current.id, categoryIds);
    await repo.setTags(current.id, tagIds);
    if (slug !== current.slug) {
      await repo.releaseSlugHistory(slug);
      if (current.publishedAt) await repo.rememberOldSlug(current.id, current.slug);
    }
    return next;
  }

  /** Applies a live article's pending copy (if any) inside `tx`. Returns the latest revision. */
  private async applyPending(tx: Queryable, id: string): Promise<{ post: AdminPost; revision: number }> {
    const repo = this.repo(tx);
    const current = await repo.findById(id);
    if (!current) throw new NotFoundError('Article');
    if (!current.hasPendingChanges) return { post: current, revision: current.revision };
    const input = this.parseInput({ ...(await repo.findPending(id) as object), revision: current.revision });
    const slug = await this.resolveSlug(repo, id, input, current.slug);
    const rendered = renderDocument(input.content, this.siteOrigin);
    const revision = await this.applyToLive(tx, current, input, slug, rendered);
    return { post: (await repo.findById(id))!, revision };
  }

  private staleError(current: AdminPost) {
    return new ConflictError(
      'This article was changed somewhere else (another tab or device). Reload to see the latest version.',
      'stale_revision',
      { revision: current.revision, updatedAt: current.updatedAt },
    );
  }

  private async resolveSlug(repo: PostRepository, id: string, input: PostInput, currentSlug: string): Promise<string> {
    if (input.slug) {
      if (!isValidSlug(input.slug)) {
        throw new ValidationError({ slug: 'Use lowercase letters, numbers and single hyphens (max 80 characters).' });
      }
      const owner = await repo.slugOwner(input.slug);
      if (owner && owner !== id) throw new ValidationError({ slug: 'Another article already uses this URL.' });
      return input.slug;
    }
    if (!input.title.trim()) return currentSlug;
    const base = slugify(input.title) || 'untitled';
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? base : `${base.slice(0, 75)}-${n}`;
      const owner = await repo.slugOwner(candidate);
      if (!owner || owner === id) return candidate;
    }
    return `${base.slice(0, 70)}-${randomBytes(3).toString('hex')}`;
  }

  private async assertMediaExists(tx: Queryable, ids: (string | null)[]): Promise<void> {
    const wanted = ids.filter((x): x is string => !!x);
    if (!wanted.length) return;
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM media_assets WHERE id = ANY($1::uuid[])', [wanted]);
    if (rows.length !== new Set(wanted).size) throw new ValidationError({ coverImageId: 'That image no longer exists.' });
  }

  /** What must be true before readers can see an article. */
  private assertPublishable(post: AdminPost): void {
    const fields: Record<string, string> = {};
    if (post.title.trim().length < 3) fields.title = 'Add a title before publishing.';
    if (post.wordCount < 1) fields.content = 'Write some content before publishing.';
    if (PLACEHOLDER_SLUG.test(post.slug)) fields.slug = 'Give the article a real URL before publishing.';
    if (Object.keys(fields).length) throw new ValidationError(fields, Object.values(fields)[0]);
  }

  async changeStatus(id: string, action: StatusAction): Promise<AdminPost> {
    await this.db.transaction(async (tx) => {
      const repo = this.repo(tx);
      const current = await repo.findById(id);
      if (!current) throw new NotFoundError('Article');
      if (current.revision !== action.revision) throw this.staleError(current);
      let next: number | null;

      switch (action.action) {
        case 'publish': {
          if (current.isLive) throw new ConflictError('This article is already published. Use Update to publish changes.', 'already_live');
          this.assertPublishable(current);
          // First publication (or a scheduled post published early) gets "now"; a re-publish keeps its original date.
          next = await repo.setStatus(id, current.revision, 'published',
            "CASE WHEN p.published_at IS NULL OR p.status = 'scheduled' THEN now() ELSE p.published_at END", null);
          break;
        }
        case 'schedule': {
          if (current.isLive) throw new ConflictError('This article is already live. Unpublish it before scheduling.', 'already_live');
          this.assertPublishable(current);
          const at = new Date(action.at);
          if (at.getTime() < Date.now() + 60_000) throw new ValidationError({ at: 'Choose a time at least a minute in the future.' });
          next = await repo.setStatus(id, current.revision, 'scheduled', '$4::timestamptz', at.toISOString());
          break;
        }
        case 'update': {
          if (!current.isLive) throw new ConflictError('Only published articles have changes to update.', 'not_live');
          const applied = await this.applyPending(tx, id);
          this.assertPublishable(applied.post);
          next = applied.revision;
          break;
        }
        case 'discard': {
          next = current.hasPendingChanges ? await repo.clearPending(id, current.revision) : current.revision;
          break;
        }
        case 'unpublish': {
          // Pending edits become the draft so no work is lost.
          const applied = await this.applyPending(tx, id);
          // A scheduled post that never went live forgets its future date.
          next = await repo.setStatus(id, applied.revision, 'draft',
            "CASE WHEN p.status = 'scheduled' AND p.published_at > now() THEN NULL ELSE p.published_at END", null);
          break;
        }
      }
      if (next === null) throw this.staleError(current);
    });
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repo().delete(id))) throw new NotFoundError('Article');
  }

  listAdmin(query: Omit<AdminListQuery, 'pageSize'>): Promise<Page<AdminListItem>> {
    return this.repo().listAdmin({ ...query, pageSize: ADMIN_PAGE_SIZE });
  }

  stats() {
    return this.repo().stats();
  }

  recentlyEdited(limit = 5) {
    return this.repo().listAdmin({ dateField: 'updated', order: 'desc', page: 1, pageSize: limit });
  }

  /** Renders the working copy exactly as readers would see it. Admin-only (enforced by middleware). */
  async preview(id: string): Promise<ArticleView> {
    const post = await this.get(id);
    const rendered = renderDocument(post.content, this.siteOrigin);
    return {
      id: post.id, title: post.title || 'Untitled', slug: post.slug, excerpt: excerptOrLead(post.excerpt, rendered.text),
      coverImage: post.coverImage, ogImage: post.ogImage, authorName: post.authorName,
      publishedAt: post.publishedAt ?? post.scheduledAt ?? new Date().toISOString(), readingMinutes: rendered.readingMinutes,
      featured: post.featured, categories: post.categories, tags: post.tags, contentHtml: rendered.html,
      wordCount: rendered.wordCount, updatedAt: post.pendingSavedAt ?? post.updatedAt,
      seoTitle: post.seoTitle, seoDescription: post.seoDescription,
    };
  }

  // ---- public reading: only ever returns live posts, never pending edits ----

  listPublic(query: Omit<PublicListQuery, 'pageSize'>): Promise<Page<PostSummary>> {
    return this.repo().listLive({ ...query, pageSize: PUBLIC_PAGE_SIZE });
  }

  latestFeatured() {
    return this.repo().latestFeatured();
  }

  /** The live article, a redirect to its current slug, or null (404). */
  async readBySlug(slug: string): Promise<{ article: ArticleView } | { redirectTo: string } | null> {
    if (!isValidSlug(slug)) return null;
    const article = await this.repo().findLiveBySlug(slug);
    if (article) return { article };
    const current = await this.repo().findRedirect(slug);
    return current ? { redirectTo: current } : null;
  }

  related(postId: string, limit = 3) {
    return this.repo().related(postId, limit);
  }

  adjacent(postId: string) {
    return this.repo().adjacent(postId);
  }

  sitemapEntries() {
    return this.repo().liveForSitemap();
  }

  publishDueScheduled() {
    return this.repo().publishDue();
  }
}
