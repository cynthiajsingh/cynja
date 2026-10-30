import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { E2E_ROOT } from './tests/e2e/paths.ts';

const PORT = 4329;
// A new database folder per run, outside the (possibly cloud-synced) project.
const E2E_DATA_DIR = process.env.LOCAL_DATA_DIR ?? path.join(E2E_ROOT, `run-${Date.now()}`);
process.env.LOCAL_DATA_DIR = E2E_DATA_DIR;

// End-to-end tests run against `astro dev` with an isolated embedded database,
// using the locally installed Microsoft Edge (or Chrome via
// PW_CHANNEL=chrome) so no browser download is needed.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL ?? 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Fresh database + random admin password, then the dev server.
    command: `node --experimental-strip-types --no-warnings tests/e2e/prepare.ts && npx astro dev --port ${PORT}`,
    url: `http://localhost:${PORT}/blogs`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { ...(process.env as Record<string, string>), LOCAL_DATA_DIR: E2E_DATA_DIR, SITE_URL: `http://localhost:${PORT}` },
  },
});
