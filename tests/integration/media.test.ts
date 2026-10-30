import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServices } from '../../src/server/container.ts';
import type { Db } from '../../src/server/db/types.ts';
import { ConflictError, ValidationError } from '../../src/server/errors.ts';
import { MAX_UPLOAD_BYTES } from '../../src/server/media/service.ts';
import { LocalFsStorage, MemoryStorage } from '../../src/server/media/storage.ts';
import { createTestServices, PNG_1X1, postInput, SITE } from '../helpers/services.ts';

let s: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => { s = await createTestServices(); });
afterAll(() => s.db.close());

describe('uploads', () => {
  it('stores a valid image with a server-generated key and reads its size', async () => {
    const asset = await s.media.upload({ name: '../../etc/passwd.png', bytes: PNG_1X1, altText: 'Dot' });
    expect(asset.key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(asset.url).toBe(`/media/${asset.key}`);
    expect(asset.mimeType).toBe('image/png');
    expect([asset.width, asset.height]).toEqual([1, 1]);
    expect(asset.originalName).not.toContain('/');
    expect(s.storage.objects.get(asset.key)?.contentType).toBe('image/png');
  });

  it.each([
    ['an SVG (script-capable)', 'evil.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['HTML renamed to .png', 'page.png', new TextEncoder().encode('<!doctype html><script>alert(1)</script>')],
    ['a PNG with a .jpg extension', 'photo.jpg', PNG_1X1],
    ['an empty file', 'empty.png', new Uint8Array()],
    ['an oversized file', 'big.png', (() => { const b = new Uint8Array(MAX_UPLOAD_BYTES + 1); b.set(PNG_1X1); return b; })()],
  ])('rejects %s', async (_label, name, bytes) => {
    await expect(s.media.upload({ name, bytes })).rejects.toBeInstanceOf(ValidationError);
  });

  it('removes the stored file if the database write fails', async () => {
    const storage = new MemoryStorage();
    const failingDb = { ...s.db, query: async (text: string, params?: readonly unknown[]) => {
      if (text.startsWith('INSERT INTO media_assets')) throw new Error('db down');
      return s.db.query(text, params);
    } } as Db;
    const svc = createServices({ db: failingDb, storage, siteOrigin: SITE });
    await expect(svc.media.upload({ name: 'a.png', bytes: PNG_1X1 })).rejects.toThrow('db down');
    expect(storage.objects.size).toBe(0);
  });

  it('refuses keys that could escape the storage folder', async () => {
    const local = new LocalFsStorage();
    await expect(local.get('../../package.json')).rejects.toThrow('Invalid media key');
    await expect(new MemoryStorage().put('../x.png', PNG_1X1, 'image/png')).rejects.toThrow('Invalid media key');
  });
});

describe('deletion', () => {
  it('refuses to delete an image still used by an article, then deletes once unused', async () => {
    const asset = await s.media.upload({ name: 'cover.png', bytes: PNG_1X1 });
    const draft = await s.posts.createDraft('A');
    const saved = await s.posts.save(draft.id, postInput(draft.revision, { title: 'Uses cover', coverImageId: asset.id }));
    await expect(s.media.delete(asset.id)).rejects.toBeInstanceOf(ConflictError);
    await s.posts.save(draft.id, postInput(saved.revision, { title: 'Uses cover', coverImageId: null }));
    await s.media.delete(asset.id);
    expect(s.storage.objects.has(asset.key)).toBe(false);
  });

  it('detects images used inside article bodies', async () => {
    const asset = await s.media.upload({ name: 'inline.png', bytes: PNG_1X1 });
    const draft = await s.posts.createDraft('A');
    await s.posts.save(draft.id, postInput(draft.revision, { title: 'Inline', content: { type: 'doc', content: [
      { type: 'figureImage', attrs: { src: asset.url, alt: 'x', caption: '', width: 100, align: 'center', mediaId: asset.id } },
    ] } }));
    expect((await s.media.usage(asset.id)).map((p) => p.title)).toEqual(['Inline']);
  });
});
