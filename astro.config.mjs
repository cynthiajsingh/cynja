// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import react from '@astrojs/react';

export default defineConfig({
  // Canonical origin used for canonical URLs, Open Graph and the sitemap.
  site: process.env.SITE_URL || 'https://cynja.in',
  output: 'server',
  // The adapter is only needed to build for Netlify. In `astro dev` it would start
  // Netlify's platform emulator (which needs Deno); local dev instead uses the
  // embedded database and the local media folder.
  adapter: process.argv.includes('dev') ? undefined : netlify(),
  integrations: [react()],
  trailingSlash: 'never',
  // Rejects cross-site form posts; JSON APIs get an explicit Origin check in middleware.
  security: { checkOrigin: true },
  vite: {
    // PGlite (local development database only) ships WebAssembly and must not be bundled.
    ssr: { external: ['@electric-sql/pglite'] },
  },
});
