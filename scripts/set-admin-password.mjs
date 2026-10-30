#!/usr/bin/env node
// Creates the admin account or resets its password, and signs out every session.
// This is the bootstrap and recovery path; there is no public sign-up endpoint.
//
//   Production (Netlify DB):  npx netlify env:get NETLIFY_DATABASE_URL  -> then
//                             DATABASE_URL="..." npm run admin:set-password
//   Local development:        npm run admin:set-password -- --local
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./set-admin-password.ts', import.meta.url));
const res = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', runner, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status ?? 1);
