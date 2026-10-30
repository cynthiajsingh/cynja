import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServices } from '../../src/server/container.ts';
import { migrate } from '../../src/server/db/migrator.ts';
import { createPgliteDb } from '../../src/server/db/pglite.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../src/server/errors.ts';
import { MemoryStorage } from '../../src/server/media/storage.ts';
import type { AdminPost } from '../../src/server/posts/types.ts';
import { createTestServices, doc, postInput, SITE } from '../helpers/services.ts';

let s: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => { s = await createTestServices(); });
afterAll(() => s.db.close());

async function publishedPost(title: string, over: Record<string, unknown> = {}): Promise<AdminPost> {
  const draft = await s.posts.createDraft('Cynthia J Singh');
  const saved = await s.posts.save(draft.id, postInput(draft.revision, { title, content: doc(`${title} body text`), ...over }));
  return s.posts.changeStatus(saved.id, { action: 'publish', revision: saved.revision });
}

describe('drafts', () => {
  it('creates a private draft', async () => {
    const draft = await s.posts.createDraft('Cynthia J Singh');
    expect(draft.status).toBe('draft');
    expect(draft.isLive).toBe(false);
    expect(await s.posts.readBySlug(draft.slug)).toBeNull();
  });

  it('saves rich content and returns the same document on reopen', async () => {
    const draft = await s.posts.createDraft('Cynthia J Singh');
    const rich = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, textAlign: null }, content: [{ type: 'text', text: 'Section' }] },
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [
          { type: 'text', text: 'Linked', marks: [{ type: 'link', attrs: { href: 'https://example.com', target: null, rel: null, class: null } }, { type: 'bold' }] },
        ] },
        { type: 'figureImage', attrs: { src: '/media/2026/10/00000000-0000-4000-8000-000000000000.png', alt: 'A', caption: 'C', width: 50, align: 'right', mediaId: null } },
        { type: 'embed', attrs: { provider: 'vimeo', id: '76979871', title: 'Talk' } },
      ],
    };
    const saved = await s.posts.save(draft.id, postInput(draft.revision, { title: 'Rich formatting', content: rich }));
    const reopened = await s.posts.get(draft.id);
    expect(reopened.content).toEqual(saved.content);
    expect(JSON.stringify(reopened.content)).toContain('"textAlign":"center"');
    expect(JSON.stringify(reopened.content)).toContain('"provider":"vimeo"');
    const preview = await s.posts.preview(draft.id);
    expect(preview.contentHtml).toContain('<a href="https://example.com/" target="_blank" rel="noopener noreferrer"><strong>Linked</strong></a>');
    expect(preview.contentHtml).toContain('class="fig fig-right w-50"');
    expect(preview.contentHtml).toContain('https://player.vimeo.com/video/76979871');
  });

  it('generates the slug from the title and keeps it unique', async () => {
    const a = await s.posts.createDraft('A');
    const b = await s.posts.createDraft('A');
    const sa = await s.posts.save(a.id, postInput(a.revision, { title: 'Giving Feedback That Lands' }));
    const sb = await s.posts.save(b.id, postInput(b.revision, { title: 'Giving Feedback That Lands' }));
    expect(sa.slug).toBe('giving-feedback-that-lands');
    expect(sb.slug).toBe('giving-feedback-that-lands-2');
  });

  it('rejects a manual slug that is taken or malformed', async () => {
    const a = await s.posts.createDraft('A');
    await expect(s.posts.save(a.id, postInput(a.revision, { slug: 'giving-feedback-that-lands' })))
      .rejects.toMatchObject({ fields: { slug: 'Another article already uses this URL.' } });
    await expect(s.posts.save(a.id, postInput(a.revision, { slug: 'Not OK!' }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects invalid input with field errors', async () => {
    const a = await s.posts.createDraft('A');
    await expect(s.posts.save(a.id, { ...postInput(a.revision), title: 'x'.repeat(201) }))
      .rejects.toMatchObject({ fields: { title: expect.any(String) } });
    await expect(s.posts.save(a.id, postInput(a.revision, { content: { type: 'doc', content: [{ type: 'script' }] } })))
      .rejects.toMatchObject({ fields: { content: expect.stringContaining('not valid') } });
  });

  it('refuses stale saves instead of silently overwriting (optimistic locking)', async () => {
    const draft = await s.posts.createDraft('A');
    const first = await s.posts.save(draft.id, postInput(draft.revision, { title: 'From tab one' }));
    // A second tab still holds the old revision.
    await expect(s.posts.save(draft.id, postInput(draft.revision, { title: 'From tab two' })))
      .rejects.toMatchObject({ code: 'stale_revision', status: 409 });
    expect((await s.posts.get(draft.id)).title).toBe('From tab one');
    expect(first.revision).toBe(draft.revision + 1);
  });

  it('serialises truly concurrent saves: exactly one wins', async () => {
    const draft = await s.posts.createDraft('A');
    const results = await Promise.allSettled([
      s.posts.save(draft.id, postInput(draft.revision, { title: 'Writer one' })),
      s.posts.save(draft.id, postInput(draft.revision, { title: 'Writer two' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
  });

  it('stores sanitised HTML for malicious content', async () => {
    const draft = await s.posts.createDraft('A');
    await s.posts.save(draft.id, postInput(draft.revision, {
      title: 'XSS',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(document.cookie)' } }] },
        { type: 'text', text: '<script>alert(1)</script>' },
      ] }] },
    }));
    const { contentHtml } = await s.posts.preview(draft.id);
    expect(contentHtml).not.toMatch(/javascript:|<script/i);
  });
});

describe('publishing lifecycle', () => {
  it('requires a title and content to publish', async () => {
    const draft = await s.posts.createDraft('A');
    const saved = await s.posts.save(draft.id, postInput(draft.revision, { title: '', content: doc('') }));
    await expect(s.posts.changeStatus(saved.id, { action: 'publish', revision: saved.revision }))
      .rejects.toMatchObject({ fields: { title: expect.any(String), content: expect.any(String) } });
  });

  const publicHtml = async (slug: string) => {
    const read = await s.posts.readBySlug(slug);
    return read && 'article' in read ? read.article.contentHtml : null;
  };

  it('publishing makes it public', async () => {
    await publishedPost('Leading With Empathy');
    expect(await publicHtml('leading-with-empathy')).toContain('Leading With Empathy body text');
  });

  it('autosaves on a live article stay private until Update', async () => {
    const post = await publishedPost('Live Edit Article');
    const edited = await s.posts.save(post.id, postInput(post.revision, {
      title: 'Live Edit Article', slug: post.slug, content: doc('A revised body'),
    }));
    expect(edited.hasPendingChanges).toBe(true);
    expect(JSON.stringify(edited.content)).toContain('A revised body');
    expect(await publicHtml('live-edit-article')).toContain('Live Edit Article body text');
    expect((await s.posts.preview(post.id)).contentHtml).toContain('A revised body');
    // Search must not see unpublished words either.
    expect((await s.posts.listPublic({ q: 'revised', page: 1 })).items).toEqual([]);

    const updated = await s.posts.changeStatus(post.id, { action: 'update', revision: edited.revision });
    expect(updated.hasPendingChanges).toBe(false);
    expect(await publicHtml('live-edit-article')).toContain('A revised body');
  });

  it('discarding pending changes restores the live version in the editor', async () => {
    const post = await publishedPost('Discard Edit Article');
    const edited = await s.posts.save(post.id, postInput(post.revision, { title: 'Discard Edit Article', slug: post.slug, content: doc('Oops draft') }));
    const discarded = await s.posts.changeStatus(post.id, { action: 'discard', revision: edited.revision });
    expect(discarded.hasPendingChanges).toBe(false);
    expect(JSON.stringify(discarded.content)).toContain('Discard Edit Article body text');
  });

  it('redirects old URLs after a published slug changes', async () => {
    const post = await publishedPost('Old Name For A Post');
    const pending = await s.posts.save(post.id, postInput(post.revision, { title: 'New Name', slug: 'new-name-for-a-post' }));
    expect(await publicHtml('old-name-for-a-post')).not.toBeNull();
    await s.posts.changeStatus(post.id, { action: 'update', revision: pending.revision });
    expect(await s.posts.readBySlug('old-name-for-a-post')).toEqual({ redirectTo: 'new-name-for-a-post' });
  });

  it('unpublishing keeps pending edits as the new draft', async () => {
    const post = await publishedPost('Fold Back Article');
    const pending = await s.posts.save(post.id, postInput(post.revision, { title: 'Fold Back Article', slug: post.slug, content: doc('Newer words') }));
    const draft = await s.posts.changeStatus(post.id, { action: 'unpublish', revision: pending.revision });
    expect(draft.status).toBe('draft');
    expect(draft.hasPendingChanges).toBe(false);
    expect(JSON.stringify(draft.content)).toContain('Newer words');
  });

  it('allows real titles that start with "Untitled"', async () => {
    const post = await publishedPost('Untitled Thoughts On Feedback');
    expect(post.slug).toBe('untitled-thoughts-on-feedback');
    expect(post.isLive).toBe(true);
  });

  it('unpublishing removes it from listings, direct access and redirects', async () => {
    const post = await publishedPost('Temporary Article');
    const pending = await s.posts.save(post.id, postInput(post.revision, { title: 'Temporary Article', slug: 'temporary-article-renamed' }));
    const updated = await s.posts.changeStatus(post.id, { action: 'update', revision: pending.revision });
    await s.posts.changeStatus(post.id, { action: 'unpublish', revision: updated.revision });
    expect(await s.posts.readBySlug('temporary-article-renamed')).toBeNull();
    expect(await s.posts.readBySlug('temporary-article')).toBeNull();
    const list = await s.posts.listPublic({ q: 'Temporary', page: 1 });
    expect(list.items.find((i) => i.id === post.id)).toBeUndefined();
  });

  it('keeps scheduled posts private until their time, then publishes them', async () => {
    const draft = await s.posts.createDraft('A');
    const saved = await s.posts.save(draft.id, postInput(draft.revision, { title: 'Scheduled Insight', content: doc('Future words') }));
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = await s.posts.changeStatus(saved.id, { action: 'schedule', revision: saved.revision, at });
    expect(scheduled.status).toBe('scheduled');
    expect(await s.posts.readBySlug('scheduled-insight')).toBeNull();
    expect((await s.posts.stats()).scheduled).toBeGreaterThanOrEqual(1);
    // Time passes.
    await s.db.query("UPDATE posts SET published_at = now() - interval '1 minute' WHERE id = $1", [saved.id]);
    expect(await s.posts.readBySlug('scheduled-insight')).not.toBeNull();
    expect(await s.posts.publishDueScheduled()).toBeGreaterThanOrEqual(1);
    expect((await s.posts.get(saved.id)).status).toBe('published');
  });

  it('rejects scheduling in the past', async () => {
    const draft = await s.posts.createDraft('A');
    const saved = await s.posts.save(draft.id, postInput(draft.revision, { title: 'Past', content: doc('x') }));
    await expect(s.posts.changeStatus(saved.id, { action: 'schedule', revision: saved.revision, at: new Date(Date.now() - 1000).toISOString() }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('deletes articles', async () => {
    const post = await publishedPost('Delete Me Please');
    await s.posts.delete(post.id);
    await expect(s.posts.get(post.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await s.posts.readBySlug('delete-me-please')).toBeNull();
  });
});

describe('public discovery', () => {
  let leadershipId: number;
  beforeAll(async () => {
    leadershipId = (await s.taxonomy.createCategory({ name: 'Leadership' })).id;
    const salesId = (await s.taxonomy.createCategory({ name: 'Sales' })).id;
    for (let i = 1; i <= 11; i++) {
      await publishedPost(`Discovery Post ${i}`, {
        categoryIds: [i % 2 ? leadershipId : salesId],
        tags: i <= 3 ? ['Feedback'] : ['Coaching'],
        content: doc(i === 7 ? 'This one mentions pivot tables' : `Ordinary body ${i}`),
      });
    }
  });

  it('paginates', async () => {
    const p1 = await s.posts.listPublic({ q: 'Discovery', page: 1 });
    const p2 = await s.posts.listPublic({ q: 'Discovery', page: 2 });
    expect(p1.items).toHaveLength(9);
    expect(p2.items).toHaveLength(2);
    expect(p1.total).toBe(11);
    expect(p1.pageCount).toBe(2);
  });

  it('searches titles and body text', async () => {
    const res = await s.posts.listPublic({ q: 'pivot tables', page: 1 });
    expect(res.items.map((i) => i.title)).toEqual(['Discovery Post 7']);
    expect((await s.posts.listPublic({ q: 'zzzz-no-match', page: 1 })).items).toEqual([]);
  });

  it('filters by category and tag', async () => {
    const byCat = await s.posts.listPublic({ category: 'leadership', page: 1 });
    expect(byCat.total).toBe(6);
    const byTag = await s.posts.listPublic({ tag: 'feedback', page: 1 });
    expect(byTag.total).toBe(3);
    const cats = await s.taxonomy.liveCategories();
    expect(cats.map((c) => c.slug)).toEqual(['leadership', 'sales']);
  });

  it('never lists drafts', async () => {
    const draft = await s.posts.createDraft('A');
    await s.posts.save(draft.id, postInput(draft.revision, { title: 'Discovery Secret Draft' }));
    const res = await s.posts.listPublic({ q: 'Secret Draft', page: 1 });
    expect(res.items).toEqual([]);
  });

  it('finds related and adjacent articles', async () => {
    const list = await s.posts.listPublic({ tag: 'feedback', page: 1 });
    const post = list.items[0]!;
    const related = await s.posts.related(post.id);
    expect(related).toHaveLength(3);
    expect(related.some((r) => r.id === post.id)).toBe(false);
    expect(related[0]!.tags.map((t) => t.slug)).toContain('feedback');
    const { previous, next } = await s.posts.adjacent(post.id);
    expect(previous || next).toBeTruthy();
  });

  it('lists live posts for the sitemap', async () => {
    const entries = await s.posts.sitemapEntries();
    expect(entries.some((e) => e.slug === 'discovery-post-1')).toBe(true);
    expect(entries.some((e) => /^untitled-[0-9a-f]{8}$/.test(e.slug))).toBe(false);
  });
});

describe('durability', () => {
  it('drafts survive a restart of the database process', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cynja-db-'));
    try {
      const db1 = await createPgliteDb(dir);
      await migrate(db1);
      const s1 = createServices({ db: db1, storage: new MemoryStorage(), siteOrigin: SITE });
      const draft = await s1.posts.createDraft('Cynthia');
      await s1.posts.save(draft.id, postInput(draft.revision, { title: 'Survives restarts', content: doc('Persisted body') }));
      await db1.close();

      const db2 = await createPgliteDb(dir);
      const s2 = createServices({ db: db2, storage: new MemoryStorage(), siteOrigin: SITE });
      const reopened = await s2.posts.get(draft.id);
      expect(reopened.title).toBe('Survives restarts');
      expect(JSON.stringify(reopened.content)).toContain('Persisted body');
      await db2.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
