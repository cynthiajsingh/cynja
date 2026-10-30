import { createServices, type Services } from '../../src/server/container.ts';
import { MemoryStorage } from '../../src/server/media/storage.ts';
import { createTestDb } from './db.ts';

export const SITE = 'https://cynja.in';

export async function createTestServices(): Promise<Services & { storage: MemoryStorage }> {
  const db = await createTestDb();
  const storage = new MemoryStorage();
  return { ...createServices({ db, storage, siteOrigin: SITE }), storage };
}

export const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

export const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })),
});

/** A complete, valid save payload; override fields as needed. */
export function postInput(revision: number, over: Record<string, unknown> = {}) {
  return {
    revision, title: 'Untitled', slug: '', excerpt: '', content: doc('Hello world'),
    coverImageId: null, ogImageId: null, authorName: 'Cynthia J Singh', featured: false,
    seoTitle: '', seoDescription: '', categoryIds: [], tags: [], ...over,
  };
}
