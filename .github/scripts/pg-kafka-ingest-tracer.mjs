// Fetch pg_kafka's published bench.json (from its evidence branch) and POST it to Tracer's
// /api/ingest, so the pg_kafka benchmark trend shows up at tracer.rtrentjones.dev/runs?tool=pg_kafka.
//
// The Tracer ingest token lives in THIS repo (the site owns the Tracer relationship + already holds
// TF_VAR_TRACER_INGEST_TOKEN for dogfood-tracer), so pg_kafka's own CI doesn't need a copy of it.
// Throughput is normalized against the real-broker figure into a 0..1 score; absolute numbers ride
// along in each case's judge_rationale. Inert without TRACER_INGEST_TOKEN.
const BENCH_URL =
  process.env.BENCH_URL ||
  'https://raw.githubusercontent.com/RTrentJones/pg_kafka/evidence/bench.json';
const baseUrl = process.env.TRACER_URL || 'https://tracer.rtrentjones.dev';
const token = process.env.TRACER_INGEST_TOKEN;

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

const cases = bench.scenarios.map((s) => ({
  name: s.name,
  passed: true,
  score: clamp(s.msgsPerSec / ceiling),
  output: String(s.msgsPerSec),
  judge_rationale: `${s.msgsPerSec.toLocaleString('en-US')} msgs/sec · p50 ${s.p50Ms}ms · p99 ${s.p99Ms}ms`,
}));

const payload = {
  tool: 'pg_kafka',
  model: bench.version || 'main',
  mode: 'benchmark',
  env: 'ci',
  git_sha: bench.gitSha,
  passed: true,
  pass_rate: clamp(best / ceiling),
  cases,
};

const res = await fetch(`${baseUrl}/api/ingest`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
console.log(`Tracer ingest → ${res.status}: ${await res.text()}`);
if (!res.ok) process.exit(1);
