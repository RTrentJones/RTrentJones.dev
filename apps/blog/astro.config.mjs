import { writeFileSync } from 'node:fs';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// Build-time artifact identity (the /__version convention): bake the commit this build was made
// from into dist, so `greenlight verify --expect-sha` / `ship` can assert the deployed artifact
// IS the one being gated — not just that the URL is healthy. GREENLIGHT_SHA is injected by the
// workers adapter at build time (framework v0.8.0+); until then sha is null, which verify treats
// as "sha unverified" (a passing check) — safe to ship ahead of the bump. An integration (not a
// src/pages file) because Astro excludes `_`-prefixed pages from routing.
const versionEndpoint = () => ({
  name: 'greenlight-version',
  hooks: {
    'astro:build:done': ({ dir }) => {
      writeFileSync(
        new URL('__version', dir),
        JSON.stringify({
          sha: process.env.GREENLIGHT_SHA ?? null,
          builtAt: new Date().toISOString(),
        }),
      );
    },
  },
});

// This is the personal repo, so `site` defaults to the real domain (SITE_URL can
// override per-env, e.g. https://beta.rtrentjones.dev for beta builds).
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://rtrentjones.dev',
  // Enforce the trailing-slash invariant the site (and verify.config) rely on: directory output +
  // Workers redirect no-slash → slash, so every internal link is canonical with the trailing slash.
  trailingSlash: 'always',
  // Keep the /v2 draft homepage (noindex) out of the sitemap too, so it's never submitted.
  integrations: [mdx(), sitemap({ filter: (page) => !page.includes('/v2') }), versionEndpoint()],
});
