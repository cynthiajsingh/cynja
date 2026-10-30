#!/usr/bin/env node
// Applies database migrations. Runs automatically in the Netlify build.
//   npm run db:migrate                 -> requires NETLIFY_DATABASE_URL or DATABASE_URL
//   node scripts/migrate.mjs --if-configured -> skips quietly when no database is set (first deploys)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ifConfigured = process.argv.includes('--if-configured');
const url = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

if (!url) {
  if (ifConfigured) {
    console.warn('[migrate] No NETLIFY_DATABASE_URL / DATABASE_URL set — skipping migrations. The blog will show "not configured" until a database is connected.');
    process.exit(0);
  }
  console.error('[migrate] Set NETLIFY_DATABASE_URL or DATABASE_URL first.');
  process.exit(1);
}

// The migrator is TypeScript; run it with Node's built-in type stripping.
const runner = fileURLToPath(new URL('./run-migrations.ts', import.meta.url));
const res = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', runner], { stdio: 'inherit', env: process.env });
process.exit(res.status ?? 1);
