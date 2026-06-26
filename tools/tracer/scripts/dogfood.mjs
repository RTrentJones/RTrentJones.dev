// Dogfood glue (APP glue, not framework logic): run Greenlight's verify and POST its result to
// Tracer's own /api/ingest, so Tracer shows up in its own dashboard. This consumes the GENERIC
// `greenlight verify --json` standards export (OTel-GenAI/OpenInference shape) added upstream — it does
// NOT reimplement verify. Inert until that export ships: if verify doesn't emit JSON yet, it skips
// cleanly. Guarded on TRACER_INGEST_TOKEN so it no-ops when unset.
//
// Usage:  node scripts/dogfood.mjs <base-url> [env]
//   e.g.  node scripts/dogfood.mjs https://tracer.rtrentjones.dev prod
import { execFileSync } from 'node:child_process';

const baseUrl = (process.argv[2] || process.env.TRACER_URL || '').replace(/\/$/, '');
const env = process.argv[3] || process.env.GREENLIGHT_ENV || 'prod';
const token = process.env.TRACER_INGEST_TOKEN;

if (!token) {
  console.log('dogfood: TRACER_INGEST_TOKEN unset — skipping (ingest is disabled).');
  process.exit(0);
}
if (!baseUrl) {
  console.error('dogfood: pass the deployed base URL as arg 1 (or set TRACER_URL).');
  process.exit(1);
}

// Ask Greenlight for the standards-shaped result. `--json` is the upstream export this depends on.
let raw;
try {
  raw = execFileSync('pnpm', ['exec', 'greenlight', 'verify', 'tracer', '--env', env, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (err) {
  // verify itself failed (a real regression) — still try to forward its JSON if it printed any.
  raw = err.stdout?.toString?.() ?? '';
}

const start = raw.indexOf('{');
if (start === -1) {
  console.log('dogfood: no JSON from `greenlight verify --json` (export not available yet) — skipping.');
  process.exit(0);
}

let result;
try {
  result = JSON.parse(raw.slice(start));
} catch {
  console.log('dogfood: verify output was not valid JSON — skipping.');
  process.exit(0);
}

const res = await fetch(`${baseUrl}/api/ingest`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(result),
});

if (!res.ok) {
  console.error(`dogfood: ingest POST failed — HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log(`dogfood: ingested verify result → ${baseUrl} (${(await res.json()).id ?? 'ok'})`);
