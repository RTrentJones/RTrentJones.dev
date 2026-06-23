import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// This is the personal repo, so `site` defaults to the real domain (SITE_URL can
// override per-env, e.g. https://beta.rtrentjones.dev for beta builds).
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://rtrentjones.dev',
  // Enforce the trailing-slash invariant the site (and verify.config) rely on: directory output +
  // Workers redirect no-slash → slash, so every internal link is canonical with the trailing slash.
  trailingSlash: 'always',
  integrations: [mdx(), sitemap()],
});
