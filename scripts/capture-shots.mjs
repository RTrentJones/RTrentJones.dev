// Generalizable screenshot-capture tool for the project write-ups.
//
// Reads scripts/shots.config.mjs and, per project, either drives a deployed URL (`url` mode) or crops
// PNGs an app's own capture spec already produced (`raw` mode), writing the results to
// apps/blog/public/<project>-<shot>.png. This is dev-only asset tooling — no framework logic, no new
// dependency: Playwright and sharp both ride in via the pnpm store (Playwright as a transitive optional
// dep of @rtrentjones/greenlight, sharp via Astro's image service), resolved the same way
// scripts/record-bamcp-demo.mjs resolves Playwright.
//
// Usage:
//   node scripts/capture-shots.mjs                     # every project in the manifest
//   node scripts/capture-shots.mjs --project tracer    # one project
//   node scripts/capture-shots.mjs --project tracer --base-url http://localhost:3000
//   SHOTS_BASE_URL=http://localhost:3000 node scripts/capture-shots.mjs --project tracer
//
// `raw`-mode apps (e.g. heistmind) need their source PNGs generated first — see that app's capture
// spec header (tools/heistmind/e2e/specs/capture-shots.spec.ts).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const PUBLIC_DIR = join(REPO, 'apps/blog/public');
const require = createRequire(`${REPO}/`);

// Resolve a package out of pnpm's store (version-agnostic; highest version wins). These aren't
// top-level deps of the site repo — they're pulled in transitively — so we can't just `import` them.
function fromStore(pkg) {
  const pnpmDir = join(REPO, 'node_modules/.pnpm');
  const entry = readdirSync(pnpmDir)
    .filter((d) => d.startsWith(`${pkg}@`))
    .sort()
    .at(-1);
  if (!entry) throw new Error(`${pkg} not found in ${pnpmDir}`);
  return require(join(pnpmDir, entry, 'node_modules', pkg));
}

const sharp = fromStore('sharp');

// Hide dev-only overlays (Next.js indicator, Vercel/live toolbar, TanStack Query devtools) so local
// captures look like prod. Harmless on a deployed URL where none of these elements exist.
const HIDE_OVERLAYS = `nextjs-portal,[data-nextjs-toast],#__next-build-watcher,[data-next-badge-root],[data-vercel-toolbar],vercel-live,vercel-live-feedback,[data-testid="vercel-toolbar"],[class*="live-feedback"],.tsqd-parent-container,[class*="tsqd"],.ReactQueryDevtools{display:none!important}`;

// --- args ---------------------------------------------------------------------------------------
function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const only = arg('--project');
const baseUrlOverride = arg('--base-url') ?? process.env.SHOTS_BASE_URL;

// --- crop ---------------------------------------------------------------------------------------
// Crop `input` (a file path or PNG Buffer) to the top-left { width?, height? } region and write it.
// Clamps to the image bounds so an over-tall crop just keeps the whole image (sharp throws otherwise).
async function cropToFile(input, outPath, crop = {}) {
  const img = sharp(input);
  const meta = await img.metadata();
  const width = Math.min(crop.width ?? meta.width, meta.width);
  const height = Math.min(crop.height ?? meta.height, meta.height);
  await img
    .extract({ left: 0, top: 0, width, height })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  return { width, height };
}

// --- modes --------------------------------------------------------------------------------------
async function runUrl(name, recipe) {
  const { chromium } = fromStore('playwright');
  const baseUrl = (baseUrlOverride ?? recipe.baseUrl ?? '').replace(/\/$/, '');
  if (!baseUrl) throw new Error(`[${name}] url mode needs a baseUrl (manifest or --base-url)`);
  console.log(`[${name}] url mode → ${baseUrl}`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({
      viewport: recipe.viewport ?? { width: 1440, height: 900 },
    });
    for (const shot of recipe.shots) {
      const url = baseUrl + shot.path;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 30_000 });
        await page.addStyleTag({ content: HIDE_OVERLAYS }).catch(() => undefined);
        await page.waitForTimeout(shot.settle ?? 600);
        const buf = await page.screenshot({ fullPage: true });
        const out = join(PUBLIC_DIR, `${name}-${shot.name}.png`);
        const { width, height } = await cropToFile(buf, out, shot.crop);
        console.log(`  ✓ ${shot.name}  ${width}×${height}  → ${out}`);
      } catch (e) {
        console.log(`  ✗ ${shot.name} (${url}): ${e.message}`);
      }
    }
  } finally {
    await browser.close();
  }
}

async function runRaw(name, recipe) {
  const source = join(REPO, recipe.source);
  console.log(`[${name}] raw mode ← ${source}`);
  for (const shot of recipe.shots) {
    const from = join(source, shot.from);
    const out = join(PUBLIC_DIR, `${name}-${shot.name}.png`);
    try {
      const { width, height } = await cropToFile(from, out, shot.crop);
      console.log(`  ✓ ${shot.name}  ${width}×${height}  (${shot.from}) → ${out}`);
    } catch (e) {
      console.log(`  ✗ ${shot.name} (${shot.from}): ${e.message}`);
    }
  }
}

// --- main ---------------------------------------------------------------------------------------
const manifest = (await import('./shots.config.mjs')).default;
mkdirSync(PUBLIC_DIR, { recursive: true });

const projects = Object.entries(manifest).filter(([name]) => !only || name === only);
if (only && projects.length === 0) {
  console.error(`No project "${only}" in the manifest. Known: ${Object.keys(manifest).join(', ')}`);
  process.exit(1);
}

for (const [name, recipe] of projects) {
  if (recipe.mode === 'url') await runUrl(name, recipe);
  else if (recipe.mode === 'raw') await runRaw(name, recipe);
  else console.log(`[${name}] unknown mode "${recipe.mode}" — skipping`);
}
console.log('done');
