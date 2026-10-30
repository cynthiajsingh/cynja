// Run by the Playwright webServer command before `astro dev` starts:
// a fresh embedded database and a random admin password for every run.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AuthService } from '../../src/server/auth/service.ts';
import { migrate } from '../../src/server/db/migrator.ts';
import { createPgliteDb } from '../../src/server/db/pglite.ts';
import { CREDS_FILE, E2E_DIR, E2E_ROOT } from './paths.ts';

mkdirSync(E2E_ROOT, { recursive: true });
// Best-effort cleanup of earlier runs.
for (const entry of readdirSync(E2E_ROOT)) {
  const full = path.join(E2E_ROOT, entry);
  if (full !== E2E_DIR && entry.startsWith('run-')) rmSync(full, { recursive: true, force: true, maxRetries: 3 });
}
const db = await createPgliteDb(path.join(E2E_DIR, 'pglite'));
await migrate(db);
const password = randomBytes(18).toString('base64url');
await new AuthService(db).setAdminPassword('e2e-admin', password);
await db.close();
writeFileSync(CREDS_FILE, JSON.stringify({ username: 'e2e-admin', password }));
console.log(`[e2e] fresh database ready in ${E2E_DIR}`);
