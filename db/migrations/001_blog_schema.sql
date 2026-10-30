-- Blog platform schema: admin auth, posts, taxonomy and media.

CREATE TABLE admins (
  id                  serial PRIMARY KEY,
  username            text NOT NULL UNIQUE,
  password_hash       text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Session ids are random 256-bit tokens; only their SHA-256 hash is stored.
CREATE TABLE sessions (
  id           text PRIMARY KEY,
  admin_id     integer NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text NOT NULL DEFAULT ''
);
CREATE INDEX sessions_admin_idx ON sessions (admin_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE login_attempts (
  id         bigserial PRIMARY KEY,
  ip_hash    text NOT NULL,
  succeeded  boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip_hash, created_at);
CREATE INDEX login_attempts_created_idx ON login_attempts (created_at);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_assets (
  id            uuid PRIMARY KEY,
  storage_key   text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  width         integer,
  height        integer,
  alt_text      text NOT NULL DEFAULT '',
  caption       text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_created_idx ON media_assets (created_at DESC);

CREATE TYPE post_status AS ENUM ('draft', 'scheduled', 'published');

CREATE TABLE posts (
  id              uuid PRIMARY KEY,
  title           text NOT NULL DEFAULT '',
  slug            text NOT NULL UNIQUE,
  excerpt         text NOT NULL DEFAULT '',
  content         jsonb NOT NULL,
  content_html    text NOT NULL DEFAULT '',
  content_text    text NOT NULL DEFAULT '',
  word_count      integer NOT NULL DEFAULT 0,
  reading_minutes integer NOT NULL DEFAULT 1,
  cover_image_id  uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  og_image_id     uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  author_name     text NOT NULL,
  status          post_status NOT NULL DEFAULT 'draft',
  featured        boolean NOT NULL DEFAULT false,
  seo_title       text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  scheduled_at    timestamptz,
  revision        integer NOT NULL DEFAULT 1,
  -- Edits to a live article are autosaved here and only reach readers on "Update".
  pending         jsonb,
  pending_saved_at timestamptz,
  search          tsvector GENERATED ALWAYS AS (
                    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
                    setweight(to_tsvector('english'::regconfig, coalesce(excerpt, '')), 'B') ||
                    setweight(to_tsvector('english'::regconfig, coalesce(content_text, '')), 'C')
                  ) STORED,
  CONSTRAINT posts_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT posts_scheduled_has_date CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CONSTRAINT posts_published_has_date CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX posts_status_published_idx ON posts (status, published_at DESC);
CREATE INDEX posts_status_scheduled_idx ON posts (status, scheduled_at);
CREATE INDEX posts_updated_idx ON posts (updated_at DESC);
CREATE INDEX posts_created_idx ON posts (created_at DESC);
CREATE INDEX posts_search_idx ON posts USING gin (search);

-- Old slugs keep working via 301 redirects after a post is renamed.
CREATE TABLE post_slug_history (
  slug       text PRIMARY KEY,
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_slug_history_post_idx ON post_slug_history (post_id);

CREATE TABLE categories (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE post_categories (
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  category_id integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);
CREATE INDEX post_categories_category_idx ON post_categories (category_id);

CREATE TABLE post_tags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX post_tags_tag_idx ON post_tags (tag_id);
