import { randomUUID } from 'node:crypto';
import type { Db } from '../db/types.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import { extensionMatches, imageDimensions, MIME_BY_KIND, sniffImage } from './sniff.ts';
import type { MediaStorage } from './storage.ts';

// Netlify Functions accept request bodies up to ~6 MB; the editor resizes large
// photos in the browser before upload, so 4 MB leaves comfortable headroom.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MEDIA_PAGE_SIZE = 40;

export interface MediaAsset {
  id: string;
  url: string;
  key: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string;
  caption: string;
  createdAt: string;
}

interface MediaRow {
  id: string; storage_key: string; original_name: string; mime_type: string; size_bytes: number;
  width: number | null; height: number | null; alt_text: string; caption: string; created_at: string;
}

export const mediaUrl = (key: string) => `/media/${key}`;

function toAsset(r: MediaRow): MediaAsset {
  return {
    id: r.id, key: r.storage_key, url: mediaUrl(r.storage_key), originalName: r.original_name,
    mimeType: r.mime_type, sizeBytes: Number(r.size_bytes), width: r.width, height: r.height,
    altText: r.alt_text, caption: r.caption, createdAt: r.created_at,
  };
}

export class MediaService {
  constructor(private readonly db: Db, private readonly storage: MediaStorage) {}

  async upload(file: { name: string; bytes: Uint8Array; altText?: string }): Promise<MediaAsset> {
    if (file.bytes.length === 0) throw new ValidationError({ file: 'The file is empty.' });
    if (file.bytes.length > MAX_UPLOAD_BYTES) {
      throw new ValidationError({ file: `Images must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller.` });
    }
    const kind = sniffImage(file.bytes);
    if (!kind) throw new ValidationError({ file: 'Only JPEG, PNG, WebP, GIF or AVIF images can be uploaded.' });
    if (!extensionMatches(kind, file.name)) {
      throw new ValidationError({ file: `The file extension does not match its contents (${kind.toUpperCase()}).` });
    }
    const id = randomUUID();
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${kind}`;
    const dims = imageDimensions(kind, file.bytes);
    const mime = MIME_BY_KIND[kind];
    const originalName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || `image.${kind}`;

    await this.storage.put(key, file.bytes, mime);
    try {
      const { rows } = await this.db.query<MediaRow>(
        `INSERT INTO media_assets (id, storage_key, original_name, mime_type, size_bytes, width, height, alt_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, key, originalName, mime, file.bytes.length, dims?.width ?? null, dims?.height ?? null, (file.altText ?? '').slice(0, 300)],
      );
      return toAsset(rows[0]!);
    } catch (err) {
      // Never leave an orphaned file behind when the database write fails.
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  async list(page = 1): Promise<{ items: MediaAsset[]; total: number }> {
    const offset = (Math.max(1, page) - 1) * MEDIA_PAGE_SIZE;
    const { rows } = await this.db.query<MediaRow & { total: number }>(
      'SELECT *, count(*) OVER() AS total FROM media_assets ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [MEDIA_PAGE_SIZE, offset],
    );
    return { items: rows.map(toAsset), total: Number(rows[0]?.total ?? 0) };
  }

  async get(id: string): Promise<MediaAsset> {
    const { rows } = await this.db.query<MediaRow>('SELECT * FROM media_assets WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundError('Image');
    return toAsset(rows[0]);
  }

  async findByKey(key: string): Promise<MediaAsset | null> {
    const { rows } = await this.db.query<MediaRow>('SELECT * FROM media_assets WHERE storage_key = $1', [key]);
    return rows[0] ? toAsset(rows[0]) : null;
  }

  async updateMeta(id: string, meta: { altText: string; caption: string }): Promise<MediaAsset> {
    const { rows } = await this.db.query<MediaRow>(
      'UPDATE media_assets SET alt_text = $2, caption = $3 WHERE id = $1 RETURNING *',
      [id, meta.altText.slice(0, 300), meta.caption.slice(0, 500)],
    );
    if (!rows[0]) throw new NotFoundError('Image');
    return toAsset(rows[0]);
  }

  /** Posts that still reference this asset (as cover, OG image or inside the body). */
  async usage(id: string): Promise<{ id: string; title: string }[]> {
    const asset = await this.get(id);
    const { rows } = await this.db.query<{ id: string; title: string }>(
      `SELECT id, title FROM posts
       WHERE cover_image_id = $1 OR og_image_id = $1 OR position($2 in content::text) > 0
       ORDER BY updated_at DESC`,
      [id, asset.url],
    );
    return rows;
  }

  async delete(id: string): Promise<void> {
    const asset = await this.get(id);
    const usedBy = await this.usage(id);
    if (usedBy.length > 0) {
      const titles = usedBy.map((p) => `“${p.title || 'Untitled'}”`).join(', ');
      throw new ConflictError(`This image is used in ${titles}. Remove it from those articles first.`, 'media_in_use', { usedBy });
    }
    await this.db.query('DELETE FROM media_assets WHERE id = $1', [id]);
    await this.storage.delete(asset.key).catch((err) => console.error('[media] storage delete failed', asset.key, err));
  }

  async read(key: string) {
    return this.storage.get(key);
  }
}
