// Record a real claude.ai + BAMCP session to a video, using Playwright.
//
// It opens a HEADED Chromium (visible on the Windows desktop via WSLg) with a persistent
// profile (so the claude.ai login sticks across runs), starts recording, and keeps the
// browser alive until a STOP sentinel file appears. You drive the actual conversation in the
// window; Playwright just captures a clean 1280x800 video. Convert the webm afterwards with
// the ffmpeg Playwright already ships (scripts/ffmpeg path printed at the end).
//
// Run in the background:  node scripts/record-bamcp-demo.mjs
// Stop it:                touch <SCRATCH>/bamcp-record/STOP
//
// playwright is a dependency of apps/blog, so resolve it from there.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';

const REPO = '/home/rtj/workspace/RTrentJones.dev';
const require = createRequire(`${REPO}/`);
// playwright isn't a top-level dep here; resolve it out of pnpm's store (version-agnostic).
const pnpmDir = `${REPO}/node_modules/.pnpm`;
const pwEntry = readdirSync(pnpmDir).find((d) => d.startsWith('playwright@'));
if (!pwEntry) throw new Error(`playwright not found in ${pnpmDir}`);
const { chromium } = require(`${pnpmDir}/${pwEntry}/node_modules/playwright`);

const DIR = process.env.REC_DIR ||
  '/tmp/claude-1000/-home-rtj-workspace-RTrentJones-dev/fc6d06fb-e74c-4c0e-aaf7-167a8b1b260f/scratchpad/bamcp-record';
const PROFILE = `${DIR}/profile`;
const VIDEO = `${DIR}/video`;
const STOP = `${DIR}/STOP`;

mkdirSync(PROFILE, { recursive: true });
mkdirSync(VIDEO, { recursive: true });
if (existsSync(STOP)) rmSync(STOP); // clear any stale sentinel

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: VIDEO, size: { width: 1280, height: 800 } },
  // Strip the automation fingerprints Cloudflare/Turnstile flag.
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--no-sandbox',
    '--start-maximized',
    '--disable-blink-features=AutomationControlled',
  ],
});
// Hide navigator.webdriver (the other main "this is a bot" tell) on every page.
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
const video = page.video();
await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded' }).catch((e) => {
  console.log('[rec] initial goto note:', e.message);
});

console.log('[rec] browser open + RECORDING.');
console.log('[rec] 1) log into claude.ai if needed  2) make sure the BAMCP connector is enabled');
console.log('[rec] 3) run the pinned demo prompts  4) then stop with:  touch', STOP);

const started = Date.now();
while (!existsSync(STOP)) {
  await new Promise((r) => setTimeout(r, 3000));
  const secs = Math.round((Date.now() - started) / 1000);
  if (secs % 30 === 0) console.log(`[rec] recording… ${secs}s`);
}

console.log('[rec] STOP seen — finalizing video…');
await ctx.close(); // flushes the webm to disk
try {
  const p = await video.path();
  console.log('[rec] VIDEO:', p);
} catch (e) {
  console.log('[rec] could not resolve video path:', e.message);
}
console.log('[rec] done');
