// Renders the site's social card (apps/blog/public/og.png) from an HTML template.
//
// The card used to be produced offline with nothing committed, so its copy could drift from the
// site's without anything catching it — which is how it ended up carrying a tagline the site had
// already retired. This makes it reproducible: one template, the palette read from the dark theme
// in apps/blog/src/styles/tokens.css, the >TJ paths lifted from public/favicon.svg, rendered by
// Playwright at 2x and downscaled by sharp to the 1200x630 the og:image meta declares.
//
// Dev-only asset tooling — no framework logic, no new dependency. Playwright and sharp both ride in
// via the pnpm store, resolved the same way scripts/capture-shots.mjs resolves them.
//
// Usage:
//   node scripts/render-og.mjs                          # write apps/blog/public/og.png
//   node scripts/render-og.mjs --out /tmp/try.png       # render somewhere else
//   node scripts/render-og.mjs --layout header-domain   # domain in the header instead of the footer
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(`${REPO}/`);

function fromStore(pkg) {
  const pnpmDir = join(REPO, 'node_modules/.pnpm');
  const entry = readdirSync(pnpmDir)
    .filter((d) => d.startsWith(`${pkg}@`))
    .sort()
    .at(-1);
  if (!entry) throw new Error(`${pkg} not found in ${pnpmDir}`);
  return require(join(pnpmDir, entry, 'node_modules', pkg));
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

// Dark-theme tokens from apps/blog/src/styles/tokens.css, plus the favicon's mint chevron.
const C = {
  bg: '#16161a',
  chip: '#1f1f24',
  fg: '#e8e8e3',
  fgMuted: '#a3a39c',
  border: '#2e2e34',
  accent: '#4ade80',
  mint: '#bbf7d0',
};

const MARK = `<svg viewBox="0 0 100 100" width="52" height="52"><rect width="100" height="100" rx="22" fill="${C.chip}"/><path d="M24 37 L38 52 L24 67" fill="none" stroke="${C.mint}" stroke-width="10" stroke-linejoin="miter" stroke-linecap="round"/><path d="M57.13 69.51L50.07 69.51L50.07 39.97L41 39.97L41 33.79L66.19 33.79L66.19 39.97L57.13 39.97Z M67.46 67.74L67.46 59.56Q69.51 61.67 71.85 62.77Q74.18 63.87 76.55 63.87Q79.32 63.87 80.61 62.48Q81.91 61.09 81.91 58.05L81.91 40.01L73.27 40.01L73.27 33.79L88.96 33.79L88.96 58.05Q88.96 64.58 86.22 67.4Q83.49 70.21 77.19 70.21Q74.92 70.21 72.44 69.59Q69.97 68.96 67.46 67.74Z" fill="${C.accent}"/></svg>`;

// The card carries identity only — name, role, domain. Everything else the page has to say is in
// its own og:description. The domain is on the card rather than left to the metadata because
// LinkedIn drops descriptions from link previews entirely, and because the card gets screenshotted.
export function html({ name, role, domain, layout }) {
  const footerDomain = layout !== 'header-domain';
  return `<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:${C.bg};color:${C.fg};
       font-family:"DejaVu Sans",sans-serif;-webkit-font-smoothing:antialiased;
       display:flex;flex-direction:column;padding:52px 72px 44px}
  .head{display:flex;align-items:center;gap:20px;padding-bottom:24px;border-bottom:1px solid ${C.border}}
  .body{flex:1;display:flex;flex-direction:column;justify-content:center}
  h1{font-size:92px;font-weight:700;letter-spacing:-.028em;line-height:1}
  .role{margin-top:22px;font-size:31px;color:${C.fgMuted};letter-spacing:-.005em}
  .mono{font-family:"DejaVu Sans Mono",monospace;font-size:19px;color:${C.fgMuted};letter-spacing:.01em}
  .foot{padding-top:26px;border-top:1px solid ${C.border}}
  .foot b{color:${C.mint};font-weight:400}
</style>
<div class="head">${MARK}${footerDomain ? '' : `<span class="mono">${domain}</span>`}</div>
<div class="body"><h1>${name}</h1><div class="role">${role}</div></div>
${footerDomain ? `<div class="foot mono"><b>&gt;</b> ${domain}</div>` : ''}`;
}

const CARD = {
  name: 'Trent Jones',
  role: 'software engineer',
  domain: 'rtrentjones.dev',
  layout: arg('--layout', 'footer-domain'),
};

const out = arg('--out', join(REPO, 'apps/blog/public/og.png'));

const { chromium } = fromStore('playwright');
const sharp = fromStore('sharp');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  });
  await page.setContent(html(CARD), { waitUntil: 'load' });
  const buf = await page.screenshot();
  await sharp(buf).resize(1200, 630).png({ compressionLevel: 9 }).toFile(out);
  console.log(`✓ 1200×630 → ${out}`);
} finally {
  await browser.close();
}
