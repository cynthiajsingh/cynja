import { z } from 'zod';
import { POST_STATUSES } from './types.ts';

const trimmed = (max: number) => z.string().trim().max(max);

/** Full editor state sent by Save Draft and autosave. */
export const postInputSchema = z.object({
  revision: z.number().int().positive(),
  title: trimmed(200),
  slug: z.string().trim().toLowerCase().max(80),
  excerpt: trimmed(500),
  content: z.unknown(),
  coverImageId: z.string().uuid().nullable(),
  ogImageId: z.string().uuid().nullable(),
  authorName: trimmed(100).min(1, 'Author is required.'),
  featured: z.boolean(),
  seoTitle: trimmed(120),
  seoDescription: trimmed(320),
  categoryIds: z.array(z.number().int().positive()).max(10),
  tags: z.array(trimmed(40).min(1)).max(20),
});
export type PostInput = z.infer<typeof postInputSchema>;

export const statusActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), revision: z.number().int().positive() }),
  z.object({ action: z.literal('unpublish'), revision: z.number().int().positive() }),
  z.object({ action: z.literal('schedule'), revision: z.number().int().positive(), at: z.string().datetime({ offset: true }) }),
  z.object({ action: z.literal('update'), revision: z.number().int().positive() }),
  z.object({ action: z.literal('discard'), revision: z.number().int().positive() }),
]);
export type StatusAction = z.infer<typeof statusActionSchema>;

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined));

export const adminListQuerySchema = z.object({
  q: trimmed(200).optional(),
  status: z.enum(POST_STATUSES).optional().or(z.literal('').transform(() => undefined)),
  categoryId: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
  dateField: z.enum(['created', 'updated', 'published']).default('updated'),
  from: optionalDate,
  to: optionalDate,
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const publicListQuerySchema = z.object({
  q: trimmed(200).optional(),
  category: z.string().regex(/^[a-z0-9-]{1,80}$/).optional().catch(undefined),
  tag: z.string().regex(/^[a-z0-9-]{1,80}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
