// The blog is a content site, so it asserts more than the generic astro smoke:
// the RSS feed and sitemap parse, and no internal links are broken.
export default {
  mode: 'api',
  checks: [
    { path: '/', status: 200 },
    { path: '/blog/', status: 200 },
    { path: '/projects/', status: 200 },
    { path: '/about/', status: 200 },
    { path: '/heistmind/', status: 200 },
    { path: '/bamcp/', status: 200 },
  ],
  rssValid: true,
  sitemapValid: true,
  noBrokenInternalLinks: true,
  // Cloudflare Workers Static Assets serve some paths before others for a few seconds right after a
  // deploy — re-run the checks until they settle (or fail for real). Needs @rtrentjones/greenlight ≥ 0.2.21.
  settleRetries: 8,
  settleMs: 5000,
};
