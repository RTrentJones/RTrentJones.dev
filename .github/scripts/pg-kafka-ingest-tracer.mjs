// Fetch pg_kafka's published bench.json (from its evidence branch) and POST it to Tracer's
// /api/ingest, so the pg_kafka benchmark trend shows up at tracer.rtrentjones.dev/runs?tool=pg_kafka.
//
// The Tracer ingest token lives in THIS repo (the site owns the Tracer relationship + already holds
// TF_VAR_TRACER_INGEST_TOKEN for dogfood-tracer), so pg_kafka's own CI doesn't need a copy of it.
// Throughput is normalized against the real-broker figure into a 0..1 score; absolute numbers ride
// along in each case's judge_rationale. Inert without TRACER_INGEST_TOKEN.
//
// The cron re-reads the same bench.json until pg_kafka publishes new evidence, so a bench Tracer
// already holds is skipped: the feed stays one point per published bench. Identity is the commit AND
// the headline throughput, not the sha alone: pg_kafka's weekly refresh re-benchmarks the same commit,
// and that fresh evidence must still land. If Tracer's summary can't be read, it posts anyway (a
// duplicate does less harm than a gap).
import { appendFileSync } from 'node:fs';
const BENCH_URL =
  process.env.BENCH_URL ||
  'https://raw.githubusercontent.com/RTrentJones/pg_kafka/evidence/bench.json';
const baseUrl = process.env.TRACER_URL || 'https://tracer.rtrentjones.dev';
const token = process.env.TRACER_INGEST_TOKEN;
const SIGNAL = 'pg_kafka|benchmark||ci'; // tool|mode|suite|env; suite is null

// One Markdown line per outcome in the Actions job summary (no-op outside Actions).
const summary = (line) => {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  } catch {
    // best-effort
  }
};

if (!token) {
  console.log('TRACER_INGEST_TOKEN unset — skipping Tracer ingest.');
  process.exit(0);
}

const benchRes = await fetch(BENCH_URL, { signal: AbortSignal.timeout(10000) });
if (!benchRes.ok) {
  console.error(`cannot fetch bench.json (${benchRes.status}) from ${BENCH_URL}`);
  process.exit(1);
}
const bench = await benchRes.json();

const clamp = (x) => Math.max(0, Math.min(1, x));
const best = Math.max(0, ...bench.scenarios.map((s) => s.msgsPerSec));
const ceiling = bench.baselines?.realBroker?.msgsPerSec || best || 1;

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
// Tracer metric keys are short identifiers; scenario names may hold spaces/punctuation.
const key = (name) => String(name).replace(/[^\w.:/-]+/g, '_').slice(0, 60);

const cases = bench.scenarios.map((s) => ({
  name: s.name,
  passed: true,
  score: clamp(s.msgsPerSec / ceiling),
  output: String(s.msgsPerSec),
  judge_rationale: `${s.msgsPerSec.toLocaleString('en-US')} msgs/sec · p50 ${s.p50Ms}ms · p99 ${s.p99Ms}ms`,
  // Raw numbers as case metrics, so the run page shows them without parsing the rationale.
  metrics: Object.fromEntries(
    Object.entries({ msgs_per_sec: num(s.msgsPerSec), p50_ms: num(s.p50Ms), p99_ms: num(s.p99Ms) }).filter(
      ([, v]) => v !== undefined,
    ),
  ),
}));

// Run metrics Tracer trends per run: best throughput, the real-broker ceiling, and each scenario's
// msgs/sec and p99 (capped well under Tracer's 64-key limit).
const metrics = { best_msgs_per_sec: best, ceiling_msgs_per_sec: ceiling };
for (const s of bench.scenarios.slice(0, 20)) {
  if (num(s.msgsPerSec) !== undefined) metrics[`${key(s.name)}.msgs_per_sec`] = s.msgsPerSec;
  if (num(s.p99Ms) !== undefined) metrics[`${key(s.name)}.p99_ms`] = s.p99Ms;
}

const gh = process.env;
const sourceUrl = gh.GITHUB_RUN_ID
  ? `${gh.GITHUB_SERVER_URL || 'https://github.com'}/${gh.GITHUB_REPOSITORY}/actions/runs/${gh.GITHUB_RUN_ID}`
  : undefined;

// Skip a bench Tracer already has. The unique `ts` bypasses the summary's edge cache.
if (bench.gitSha) {
  const sha7 = String(bench.gitSha).slice(0, 7);
  try {
    const url = `${baseUrl}/api/summary/pg_kafka?signal=${encodeURIComponent(SIGNAL)}&ts=${Date.now()}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const latest = (await r.json()).signals_detail?.[0];
      if (latest?.git_sha === bench.gitSha && latest?.headline?.value === best) {
        console.log(`unchanged bench (${sha7}) — skipping`);
        summary(`⏭️ Tracer: pg_kafka bench unchanged (${sha7}), skipped duplicate`);
        process.exit(0);
      }
    } else {
      console.warn(`Tracer summary → ${r.status}; posting without the duplicate check`);
    }
  } catch (err) {
    console.warn(`Tracer summary unreadable (${err.message}); posting without the duplicate check`);
  }
}

const payload = {
  tool: 'pg_kafka',
  // The system under test is pg_kafka itself; its release rides in labels.version so one series
  // trends across versions instead of splitting per release.
  model: 'pg_kafka',
  mode: 'benchmark',
  env: 'ci',
  git_sha: bench.gitSha,
  passed: true,
  pass_rate: clamp(best / ceiling),
  repo: 'RTrentJones/pg_kafka', // git_sha is pg_kafka's commit, so the link targets that repo
  source_url: sourceUrl,
  metrics,
  labels: {
    version: String(bench.version ?? 'unknown'),
    headline_metric: 'best_msgs_per_sec',
    headline_unit: 'msgs/s',
    cadence: 'weekly',
  },
  cases,
};

let res;
try {
  res = await fetch(`${baseUrl}/api/ingest`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
} catch (err) {
  console.error(`Tracer ingest failed: ${err.message}`);
  summary(`⚠️ Tracer: pg_kafka ingest failed (${err.message})`);
  process.exit(1);
}
const body = await res.text();
console.log(`Tracer ingest → ${res.status}: ${body}`);
summary(
  res.ok
    ? `✅ Tracer: posted pg_kafka bench (${res.status})`
    : `⚠️ Tracer: pg_kafka ingest failed (HTTP ${res.status})`,
);
if (!res.ok) process.exit(1);
