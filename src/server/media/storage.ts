import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localDataDir } from '../config.ts';

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

/** Durable binary storage for uploaded media. Keys are generated server-side only. */
export interface MediaStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export const MEDIA_KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|avif)$/;

export function assertValidKey(key: string): void {
  if (!MEDIA_KEY_PATTERN.test(key)) throw new Error('Invalid media key');
}

/** Production: Netlify Blobs, a durable object store bundled with every Netlify site. */
export class NetlifyBlobsStorage implements MediaStorage {
  private storePromise: Promise<import('@netlify/blobs').Store> | undefined;

  private store() {
    this.storePromise ??= import('@netlify/blobs').then(({ getStore }) =>
      getStore({ name: 'blog-media', consistency: 'strong' }),
    );
    return this.storePromise;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    assertValidKey(key);
    const copy = new Uint8Array(bytes); // detached ArrayBuffer of exactly this length
    await (await this.store()).set(key, copy.buffer, { metadata: { contentType } });
  }

  async get(key: string): Promise<StoredObject | null> {
    assertValidKey(key);
    const res = await (await this.store()).getWithMetadata(key, { type: 'arrayBuffer' });
    if (!res) return null;
    return { bytes: new Uint8Array(res.data), contentType: String(res.metadata.contentType ?? 'application/octet-stream') };
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await (await this.store()).delete(key);
  }
}

/** Local development: files under .data/media (gitignored). */
export class LocalFsStorage implements MediaStorage {
  private readonly root: string;
  constructor(root = path.resolve(process.cwd(), localDataDir(), 'media')) {
    this.root = root;
  }

  private file(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid media key');
    return full;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(`${file}.json`, JSON.stringify({ contentType }));
  }

  async get(key: string): Promise<StoredObject | null> {
    const file = this.file(key);
    try {
      const [bytes, meta] = await Promise.all([readFile(file), readFile(`${file}.json`, 'utf8')]);
      return { bytes: new Uint8Array(bytes), contentType: JSON.parse(meta).contentType };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.file(key);
    await rm(file, { force: true });
    await rm(`${file}.json`, { force: true });
  }
}

/** Tests only. */
export class MemoryStorage implements MediaStorage {
  readonly objects = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    assertValidKey(key);
    this.objects.set(key, { bytes, contentType });
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
