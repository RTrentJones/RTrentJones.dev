// The blog is a content site, so it asserts more than the generic astro smoke:
// the RSS feed and sitemap parse, and no internal links are broken.
export default {
  mode: 'api',
  checks: [
    { path: '/', status: 200 },
    { path: '/blog/', status: 200 },
    { path: '/projects/', status: 200 },
    { path: '/about/', status: 200 },
    { path: '/greenlight/', status: 200 },
    { path: '/heistmind/', status: 200 },
    { path: '/bamcp/', status: 200 },
    { path: '/pg_kafka/', status: 200 },
    // The custom 404 page serves (with a 404 status) for unmatched paths — confirms
    // wrangler's not_found_handling: "404-page" is wired and the silly page is reachable.
    // A reserved sentinel path (never a real route) so adding a page can't break this check.
    // Trailing slash to match the site's trailingSlash:'always' invariant (a no-slash path gets the
    // dev server's built-in 404 locally; the custom page serves for the canonical slash form).
    { path: '/__greenlight_404_probe__/', status: 404, contains: 'check failed' },
  ],
  rssValid: true,
  sitemapValid: true,
  noBrokenInternalLinks: true,
  // Cloudflare Workers Static Assets serve some paths before others for a few seconds right after a
  // deploy — re-run the checks until they settle (or fail for real). Needs @rtrentjones/greenlight ≥ 0.2.21.
  settleRetries: 8,
  settleMs: 5000,
};
