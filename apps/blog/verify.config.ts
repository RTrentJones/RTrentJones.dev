// The blog is a content site, so it asserts more than the generic astro smoke:
// the RSS feed and sitemap parse, and no internal links are broken.
export default {
  mode: 'api',
  checks: [{ path: '/', status: 200 }],
  rssValid: true,
  sitemapValid: true,
  noBrokenInternalLinks: true,
};
