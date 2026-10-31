# cynja.in — Cynthia J Singh

Personal website plus a blogging platform: a public blog at **/blogs** and a private
writing studio at **/admin**.

- The homepage is the original hand-built page, kept unchanged at `public/index.html`.
- The blog is server-rendered with [Astro](https://astro.build) on Netlify Functions.
- Articles live in Postgres ([Netlify DB](https://docs.netlify.com/build/data-and-storage/netlify-db/), powered by Neon).
- Images live in [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/).

---

## 1. Architecture

```
Browser ──► Netlify CDN ──► public/index.html, /images/*   (static homepage, unchanged)
                     └────► Astro SSR function
                              ├─ /blogs, /blogs/:slug, /sitemap.xml, /blogs/rss.xml   (public, live posts only)
                              ├─ /admin/*            (pages, signed-in admin only)
                              ├─ /api/admin/*        (JSON API, signed-in + CSRF + Origin checks)
                              └─ /media/*            (serves uploaded images from Netlify Blobs)
                         Postgres (Netlify DB / Neon)   Netlify Blobs ("blog-media" store)
Netlify Scheduled Function (every 10 min): publish due scheduled posts, purge expired sessions
```

| Layer | Where |
|---|---|
| Presentation (public) | `src/pages/blogs`, `src/components/blog`, `src/layouts/SiteLayout.astro`, `src/styles` |
| Presentation (admin, React islands) | `src/pages/admin`, `src/admin` |
| API routes (thin) | `src/pages/api/admin`, `src/server/http.ts` |
| Use cases / domain | `src/server/posts/service.ts`, `src/server/auth/service.ts`, `src/server/media/service.ts`, `src/server/taxonomy`, `src/server/settings` |
| Persistence (all SQL) | `src/server/posts/repository.ts`, the services above, `db/migrations/*.sql` |
| Storage abstraction | `src/server/media/storage.ts` (Netlify Blobs / local folder / memory for tests) |
| Shared editor schema and rules | `src/shared` (used by the editor *and* the server renderer) |
| Auth and security | `src/middleware.ts`, `src/server/auth/*` |

Key decisions:

- **Astro + Netlify Functions.** The site was a single static file on Netlify. Astro adds
  server rendering (for SEO) without touching the homepage, and needs no extra servers.
- **Tiptap 3 editor.** It's a mature ProseMirror-based editor. Articles are stored as
  structured JSON. One schema (`src/shared/editor/schema.ts`) drives both the editor and
  the server renderer, so the admin preview and the public page always match.
- **Defence in depth for content.** Stored JSON is validated against the schema. The
  rendered HTML then passes an allowlist sanitizer (`sanitize-html`). Embeds store only
  `{provider, id}`, and the iframe URL is rebuilt from fixed templates (YouTube, Vimeo,
  Loom, Spotify).
- **Optimistic concurrency.** Every save carries a `revision`; a stale save gets
  HTTP 409, and autosave stops instead of overwriting newer work.
- **Editing a live article.** Autosaves go to a private *pending* copy, and readers keep
  seeing the published version until you click **Update** (or **Discard changes**).
- **scrypt password hashing** (N=2¹⁷, r=8, p=1, per OWASP), built into Node. It avoids
  shipping native Argon2/bcrypt binaries inside serverless functions.

## 2. Local development

Requirements: Node 22+.

```bash
npm install
npm run admin:set-password -- --local     # create a local admin (prompts for username/password)
npm run dev                                # http://localhost:4321 (homepage), /blogs, /admin
```

Local development needs no database server. It uses an embedded Postgres (PGlite)
stored in `.data/pglite`, and uploaded images go to `.data/media`. Both are gitignored.
To start fresh, delete `.data/`.

## 3. Environment variables

Set these in **Netlify → Site configuration → Environment variables**. None of them is ever sent to the browser.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (production) | Postgres connection string from Neon (or any Postgres). `NETLIFY_DATABASE_URL` is also read, for databases made with the old Netlify DB extension. |
| `SESSION_SECRET` | yes (production) | At least 32 random characters. Signs CSRF tokens and keys the login rate limiter. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `SITE_URL` | recommended | Canonical origin, e.g. `https://cynja.in`. Used for canonical URLs, Open Graph, the sitemap and link handling. Defaults to `https://cynja.in`. |
| `MEDIA_STORAGE` | no | `netlify-blobs` (production default) or `local` (development default). |
| `LOCAL_DATA_DIR` | no | Development and tests only: where the embedded database and local media live. |

Netlify Blobs needs no configuration; it is available to every Netlify site.

## 4. First-time production setup

Netlify already deploys this repository's `main` branch. `netlify.toml` sets the
build command (`npm run build`), which applies database migrations and then builds the site.

1. **Push to `main`.** The site deploys. Until a database exists, `/blogs` shows
   "temporarily unavailable" and `/admin` says the database isn't configured. The
   homepage is unaffected.
2. **Create the database.** The Netlify DB (Neon) extension no longer creates new
   databases, so create one directly in Neon:
   - Sign up at **https://neon.tech** (the free tier is enough) and create a project in the
     region closest to the site's functions (e.g. AWS US East).
   - On the project dashboard, click **Connect** and copy the connection string
     (`postgresql://…neon.tech/neondb?sslmode=require…`).
   - In Netlify, add it as the environment variable **`DATABASE_URL`**, marked as secret.
3. **Add `SESSION_SECRET`** and **`SITE_URL=https://cynja.in`** as environment variables.
4. **Redeploy** (Deploys → Trigger deploy). The build log should show
   `[migrate] applied 001_blog_schema.sql`.
5. **Create your admin account** from your computer (there is deliberately no public sign-up page):
   ```bash
   DATABASE_URL="postgres://…" npm run admin:set-password   # on Windows PowerShell: $env:DATABASE_URL="postgres://…"; npm run admin:set-password
   ```
   Then sign in at `https://cynja.in/admin/login`.
6. **Point cynja.in at Netlify** (see below).

### Point the domain at Netlify (done October 2026)

cynja.in used to use GoDaddy "forwarding with masking", which showed `cynja.netlify.app`
inside a frame: search engines saw only an empty frame and browsers blocked the admin
login cookie. It now points directly at Netlify. For reference, the steps were:

1. In **Netlify → Domain management → Add a domain**, enter `cynja.in` and follow the prompts.
2. In **GoDaddy → My Products → DNS for cynja.in**:
   - Remove the **Forwarding** rule.
   - Set the records Netlify shows. Typically that's an `A` record `@ → 75.2.60.5` and a
     `CNAME` `www → cynja.netlify.app`.
   - Alternatively, switch the nameservers to Netlify DNS.
3. Wait for DNS to propagate. Netlify then issues the HTTPS certificate automatically.
4. Afterwards, restrict framing to the site itself (`frame-ancestors 'self'` in the `/*`
   headers in `netlify.toml`).

Sign in at **https://cynja.in/admin**.

## 5. Writing workflow

`Draft → Preview → Publish → Update / Unpublish`, plus **Schedule**.

- **Create New Blog** creates a private draft. Everything autosaves about 1.5 seconds
  after you stop typing. The bar at the top shows *Saving… / Saved / Save failed /
  Save blocked*. Ctrl/⌘+S saves immediately.
- **Preview** opens the article exactly as readers will see it. Only you can open it.
- **Publish** makes it live. Title, content and a real URL slug are required.
- After publishing, edits are saved privately (*Unpublished changes*). **Update** publishes
  them, and **Discard changes** reverts the editor to the live version.
- **Unpublish** takes the article off the site; it becomes a draft again.
- **Schedule** sets a future time, and the article goes live automatically at that time.
  Public pages treat a scheduled article as live the moment its time passes, and a
  10-minute scheduled function then tidies up its status, so a late function run never
  delays publication.
- Changing the slug of a published article creates a **301 redirect** from the old URL.
- If you edit the same article in two tabs, the second save is refused rather than
  overwriting the first. The editor then offers *Load latest version* or *Keep mine*.
- Closing the tab or navigating away with unsaved work shows the browser's warning.

Editor features: headings (H2–H4), bold, italic, underline, strikethrough, alignment,
bulleted and numbered (nested) lists, quotes, dividers, inline code, code blocks with
syntax highlighting, links (validated; external links open in a new tab with
`noopener`), images (upload, library, drag-drop or paste, alt text, caption, width,
alignment), YouTube/Vimeo/Loom/Spotify embeds, tables (add or remove rows and columns,
header row, merge/split), undo/redo, find & replace, focus mode, and keyboard shortcuts
(press **?** in the toolbar for the list).

Images: JPEG, PNG, WebP, GIF or AVIF. Large photos are resized to 2400px and converted
to WebP in your browser before upload, which also strips camera metadata. The limit is
4 MB after resizing, because Netlify Functions accept requests up to about 6 MB. An
image that is still used by an article can't be deleted from the media library.

## 6. Passwords

- **Change** it in **Admin → Settings**. Your current password is required, and every
  other signed-in device is signed out.
- **Forgot it / reset:** run `npm run admin:set-password` against the production
  database (step 5 above). This replaces the password and signs out every session.
  Reset is intentionally a server-side administrative step, not an email link.

## 7. Security summary

- **Sessions.** A random 256-bit token is kept in an `HttpOnly`, `Secure`,
  `SameSite=Strict`, `__Host-` cookie, and only its SHA-256 hash is stored. Sessions end
  after 7 days, or after 24 hours of inactivity. A new session id is issued on every
  login, and all sessions are revoked on a password change or reset.
- **Login.** Passwords are hashed with scrypt, and an unknown username takes the same
  time to reject as a wrong password. The rate limit is 5 failures per IP (and 50
  overall) per 15 minutes. IP addresses are stored only as keyed hashes.
- **Every `/admin` and `/api/admin` request is authenticated in middleware.** Every
  change request also needs a same-origin `Origin` header and a session-bound CSRF
  token.
- **Draft privacy.** Public queries only ever return live posts. Drafts, previews,
  admin pages and APIs are sent with `noindex` / `X-Robots-Tag` and
  `Cache-Control: no-store`, and `robots.txt` disallows `/admin` and `/api`.
- **Content and HTML.**
  - All SQL is parameterised.
  - Rich text is schema-validated and allowlist-sanitized.
  - Embeds are rebuilt from a provider allowlist.
  - There is a Content Security Policy, and admin pages forbid framing.
- **Uploads.** File types are recognised from the file's actual bytes, never its name
  or declared type. The extension must match the content, SVG is refused, sizes are
  limited, and storage keys are generated by the server (no path traversal). Images are
  served with `nosniff` and a sandboxing CSP.

## 8. Tests and checks

```bash
npm run lint        # ESLint (TypeScript + Astro)
npm run check       # astro check (TypeScript, strict)
npm test            # unit + integration tests (real Postgres via PGlite, in memory)
npm run test:e2e    # Playwright end-to-end + axe accessibility checks (uses installed Microsoft Edge;
                    # set PW_CHANNEL=chrome to use Chrome)
npm run build       # production build
```

## 9. Backups and recovery

- **Database:**
  - Neon keeps point-in-time history; check your plan's restore window in the Neon
    console under **Branches → Restore**.
  - For your own copies, run a periodic dump, for example monthly:
    `pg_dump "$NETLIFY_DATABASE_URL" -Fc -f cynja-$(date +%F).dump`
  - Restore with `pg_restore -d <url> --clean cynja-YYYY-MM-DD.dump`.
- **Images:** Netlify Blobs are durable but have no point-in-time restore. To keep a
  copy, list and download them with `npx netlify blobs:list blog-media` and
  `npx netlify blobs:get blog-media <key> -o <file>`. Every key is also listed in the
  `media_assets` table.
- **Credentials:** keep the database connection string and `SESSION_SECRET` only in
  Netlify environment variables and your password manager.
  - If the database URL leaks, rotate the database password in Neon.
  - If `SESSION_SECRET` changes, open admin tabs simply need a reload; existing sessions
    remain valid, because the CSRF token is re-derived.

## 10. Operations

- **Logs:** Netlify → Logs → Functions (SSR function and `publish-scheduled`). Server
  errors are logged there and never shown in detail to visitors.
- **Free-tier fit:**
  - The site, functions, scheduled function, Netlify Blobs and the Neon free tier
    comfortably cover a personal blog.
  - Paid infrastructure is only needed for large traffic or long database restore
    windows.
