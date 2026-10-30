import type { JSONContent } from '@tiptap/core';

export const POST_STATUSES = ['draft', 'scheduled', 'published'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export interface TaxonomyRef {
  id: number;
  name: string;
  slug: string;
}

export interface ImageRef {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/** Everything the admin editor needs. Never sent to public pages. */
export interface AdminPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: JSONContent;
  wordCount: number;
  readingMinutes: number;
  coverImage: ImageRef | null;
  ogImage: ImageRef | null;
  authorName: string;
  status: PostStatus;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  scheduledAt: string | null;
  revision: number;
  categories: TaxonomyRef[];
  tags: TaxonomyRef[];
  /** True when visitors can currently read it. */
  isLive: boolean;
  /** Live articles only: autosaved edits that readers don't see until "Update". */
  hasPendingChanges: boolean;
  pendingSavedAt: string | null;
}

export interface PostSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  coverImage: ImageRef | null;
  authorName: string;
  publishedAt: string;
  readingMinutes: number;
  featured: boolean;
  categories: TaxonomyRef[];
  tags: TaxonomyRef[];
}

/** A rendered article for the public reader and the admin preview. */
export interface ArticleView extends PostSummary {
  contentHtml: string;
  wordCount: number;
  updatedAt: string;
  seoTitle: string;
  seoDescription: string;
  ogImage: ImageRef | null;
}

export interface AdminListItem {
  id: string;
  title: string;
  slug: string;
  status: PostStatus;
  isLive: boolean;
  hasPendingChanges: boolean;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  scheduledAt: string | null;
  wordCount: number;
  categories: TaxonomyRef[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
