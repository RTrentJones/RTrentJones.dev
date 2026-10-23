import { type SQL, sql } from 'drizzle-orm';
import { getDb } from './db';
import { deriveRegressions } from './regression';
import { type MatrixCase, NO_SUITE } from './signals';
import type { CompareCell, EvalCase, EvalRun, RunFilters, RunWithRegression } from './types';

// All reads are raw parameterised SQL via Drizzle's `sql` template (auto-parameterised — no
// injection) executed with db.execute(), which returns { rows }. The DISTINCT ON / window queries are
// clearer as SQL than as the query builder; regressions MUST be derived on read (in TS, see
// runsWithRegression) and the signal/diff/flaky shaping lives in lib/signals (pure, unit-tested).

// A v4 UUID is the only valid run id (gen_randomUUID / crypto.randomUUID). Validate before binding it
// into `WHERE id = …`: Postgres would otherwise raise `invalid input syntax for type uuid` on a
// malformed value, surfacing as a misleading "DATABASE_URL misconfigured" boundary instead of a 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Timestamps can arrive as a Date or as Postgres text (`2026-10-21 19:13:23.155+00`) depending on the
// driver; normalise to ISO-8601 so pages, the public JSON, and the pure helpers (which compare
// started_at lexically) all see one shape. Sub-millisecond precision is dropped, which only matters for
// ordering — and the ordering queries compare in SQL (see runWithBaseline), never on this string.
export function toIso(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v.includes('T') ? v : v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return v;
}

function normalise<T>(row: T): T {
  const r = row as Record<string, unknown>;
  if ('started_at' in r) r.started_at = toIso(r.started_at);
  return row;
}

async function rows<T>(query: SQL): Promise<T[]> {
  const res = await getDb().execute(query);
  return (res.rows as T[]).map(normalise);
}

// `suite` filter: the NO_SUITE sentinel selects the null suite (a URL/select can't carry SQL null).
const suiteEq = (suite: string) => (suite === NO_SUITE ? sql`suite IS NULL` : sql`suite = ${suite}`);

// Build a WHERE fragment from optional series-dimension filters + an optional recency bound.
// Empty → no clause.
function whereFilters(f: RunFilters, sinceDays?: number): SQL {
  const conds: SQL[] = [];
  if (f.tool) conds.push(sql`tool = ${f.tool}`);
  if (f.mode) conds.push(sql`mode = ${f.mode}`);
  if (f.suite) conds.push(suiteEq(f.suite));
  if (f.model) conds.push(sql`model = ${f.model}`);
  if (f.env) conds.push(sql`env = ${f.env}`);
  if (sinceDays != null) conds.push(sql`started_at >= now() - (${sinceDays}::int * interval '1 day')`);
  return conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
}

// Per-run count of GATED cases (reported cases are informational): lets the regression deriver tell a
// run that scored nothing (it has cases, all reported) from one that scored. A run with NO case rows is
// a run-level-only result, not an unscored one, so it reads NULL ("not applicable"), never 0.
// Correlated, uses idx_eval_case_run. Expects the outer eval_run aliased `r`.
const GATED_CASES = sql`(
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE count(*) FILTER (WHERE c.category IS DISTINCT FROM 'reported') END
  FROM eval_case c WHERE c.run_id = r.id
)::int AS gated_cases`;

type RunRow = EvalRun & { gated_cases: number | null };

/** How many earlier runs a regression baseline may sit behind (also runWithBaseline's lookback). */
const BASELINE_LOOKBACK = 50;

/**
 * The newest `perSignal` runs of EVERY signal — (tool, mode, suite, env) — within `sinceDays`, annotated
 * with regression flags. One window-function scan feeds the whole overview: lib/signals.groupSignals
 * turns these rows into per-signal latest + sparkline history, and projectHealth rolls them up.
 * Regression flags are derived over a deeper window than is returned — each signal's newest
 * `perSignal + BASELINE_LOOKBACK` runs — so a baseline older than the displayed history (behind a run
 * of incomplete runs, or other models' runs in the same signal) still counts. The lookback matches
 * runWithBaseline's, so the overview, summary and badge agree with the run page.
 */
export async function recentSignalRuns(
  f: Pick<RunFilters, 'tool'> = {},
  perSignal = 20,
  sinceDays = 180,
): Promise<RunWithRegression[]> {
  const toolFilter = f.tool ? sql`AND tool = ${f.tool}` : sql``;
  const ordered = await rows<RunRow & { rn?: unknown }>(sql`
    SELECT r.*, ${GATED_CASES} FROM (
      SELECT e.*,
             row_number() OVER (
               PARTITION BY tool, mode, coalesce(suite, ''), env
               ORDER BY started_at DESC, id DESC
             ) AS rn
      FROM eval_run e
      WHERE started_at >= now() - (${sinceDays}::int * interval '1 day') ${toolFilter}
    ) r
    WHERE rn <= ${perSignal + BASELINE_LOOKBACK}
    ORDER BY started_at ASC, id ASC
  `);
  // Derive over the whole fetched window, then return only the displayed history.
  return deriveRegressions(ordered)
    .filter((r) => Number(r.rn) <= perSignal)
    .map(({ rn: _rn, ...r }) => r as RunWithRegression);
}

/**
 * Runs (optionally filtered) annotated with regression flags, derived on read by the unit-tested
 * `deriveRegressions` (lib/regression) — the single regression implementation; there is no SQL mirror.
 *
 * The filters (tool/mode/suite/model/env) are exactly the series-key dimensions, so a filter can only
 * drop ENTIRE series, never truncate one — every remaining series is complete and its baseline stays
 * correct. We fetch the matching rows oldest-first (with `id` as the equal-timestamp tiebreaker for
 * deterministic ordering), derive, then sort newest-first and take `limit`.
 *
 * `sinceDays` bounds the inner scan to recent history (default 90d) so it doesn't materialize the full
 * table on free-tier Neon. Trade-off: the earliest run in the window has no in-window predecessor, so
 * its regression flag is computed against null (a >90d-old baseline is stale for a CI dashboard anyway).
 */
export async function runsWithRegression(
  f: RunFilters = {},
  limit = 100,
  sinceDays = 90,
): Promise<RunWithRegression[]> {
  const ordered = await rows<RunRow>(sql`
    SELECT r.*, ${GATED_CASES} FROM eval_run r
    ${whereFilters(f, sinceDays)}
    ORDER BY started_at ASC, id ASC
  `);
  return deriveRegressions(ordered)
    .sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id))
    .slice(0, limit);
}

/** A single run by id (or null); a non-UUID id returns null (→ notFound) instead of a DB cast error. */
export async function getRun(id: string): Promise<EvalRun | null> {
  if (!UUID_RE.test(id)) return null;
  const r = await rows<EvalRun>(sql`SELECT * FROM eval_run WHERE id = ${id} LIMIT 1`);
  return r[0] ?? null;
}

/** Cases for a run, gated failures first (the interpretability angle: show what broke at the top);
 * reported cases sort with the passes — they are informational, never a failure. */
export function getCases(runId: string): Promise<EvalCase[]> {
  return rows<EvalCase>(sql`
    SELECT * FROM eval_case WHERE run_id = ${runId}
    ORDER BY (passed OR category IS NOT DISTINCT FROM 'reported'), category NULLS LAST, name
  `);
}

/**
 * A run annotated against its baseline, plus that baseline row — the run page's "compared with previous"
 * uses the SAME rule as the run list (lib/regression: the latest earlier run in the series with a
 * pass_rate that is not incomplete). Reads the run and up to BASELINE_LOOKBACK predecessors in the
 * series.
 */
export async function runWithBaseline(
  run: EvalRun,
): Promise<{ run: RunWithRegression; baseline: RunWithRegression | null }> {
  const series = await rows<RunRow>(sql`
    SELECT r.*, ${GATED_CASES} FROM eval_run r
    WHERE tool = ${run.tool} AND mode = ${run.mode} AND suite IS NOT DISTINCT FROM ${run.suite}
      AND model = ${run.model} AND env = ${run.env}
      AND (started_at, id) <= (SELECT started_at, id FROM eval_run WHERE id = ${run.id}::uuid)
    ORDER BY started_at DESC, id DESC
    LIMIT ${BASELINE_LOOKBACK + 1}
  `);
  const derived = deriveRegressions(series.reverse());
  const self = derived.find((r) => r.id === run.id) ?? deriveRegressions([{ ...run, gated_cases: null }])[0];
  const baseline = self.baseline_id ? (derived.find((r) => r.id === self.baseline_id) ?? null) : null;
  return { run: self, baseline };
}

/** How many runs were recorded in the last `days` days (a true count, not a windowed row cap). */
export async function countRunsSince(days: number): Promise<number> {
  const r = await rows<{ n: number | string }>(sql`
    SELECT count(*)::int AS n FROM eval_run WHERE started_at >= now() - (${days}::int * interval '1 day')
  `);
  return Number(r[0]?.n ?? 0);
}

/** The newest `limit` runs of one signal (tool, mode, suite, env), returned oldest → newest. */
export async function signalRuns(
  s: { tool: string; mode: string; suite: string | null; env: string },
  limit = 15,
): Promise<EvalRun[]> {
  const r = await rows<EvalRun>(sql`
    SELECT * FROM eval_run
    WHERE tool = ${s.tool} AND mode = ${s.mode} AND suite IS NOT DISTINCT FROM ${s.suite} AND env = ${s.env}
    ORDER BY started_at DESC, id DESC
    LIMIT ${limit}
  `);
  return r.reverse();
}

/** Verdicts (no text columns) for a set of runs — the case × run matrix and flaky detection. */
export function casesForRuns(runIds: string[]): Promise<MatrixCase[]> {
  const ids = runIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return Promise.resolve([]);
  return rows<MatrixCase>(sql`
    SELECT run_id, name, passed, score, category FROM eval_case
    WHERE run_id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);
}

/**
 * Compare models on ONE scope: the latest run per model on exactly (tool, mode, suite, env) — never
 * spanning suites — with each model's cases. The page pivots these rows into a per-case matrix keyed by
 * case name. `suite === NO_SUITE` selects the null suite.
 */
export function compareModels(scope: {
  tool: string;
  mode: string;
  suite: string;
  env: string;
}): Promise<CompareCell[]> {
  return rows<CompareCell>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (model) id, model, started_at, git_sha, pass_rate
      FROM eval_run
      WHERE tool = ${scope.tool} AND mode = ${scope.mode} AND env = ${scope.env} AND ${suiteEq(scope.suite)}
      ORDER BY model, started_at DESC, id DESC
    )
    SELECT l.model, l.id AS run_id, l.started_at, l.git_sha, l.pass_rate,
           c.name, c.score, c.passed, c.judge_rationale, c.category
    FROM latest l
    JOIN eval_case c ON c.run_id = l.id
    ORDER BY c.name, l.model
  `);
}

/** The (tool, mode, suite, env) of the most recent run (within 180 days) that has at least one case and
 * matches the filters — /compare's default scope. `suite` is NO_SUITE for the null suite. */
export async function latestCaseScope(
  f: { tool?: string; mode?: string; suite?: string; env?: string } = {},
): Promise<{ tool: string; mode: string; suite: string; env: string } | null> {
  const conds: SQL[] = [
    sql`started_at >= now() - (180 * interval '1 day')`,
    sql`EXISTS (SELECT 1 FROM eval_case c WHERE c.run_id = r.id)`,
  ];
  if (f.tool) conds.push(sql`tool = ${f.tool}`);
  if (f.mode) conds.push(sql`mode = ${f.mode}`);
  if (f.suite) conds.push(suiteEq(f.suite));
  if (f.env) conds.push(sql`env = ${f.env}`);
  const r = await rows<{ tool: string; mode: string; suite: string | null; env: string }>(sql`
    SELECT tool, mode, suite, env FROM eval_run r
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `);
  const top = r[0];
  return top ? { tool: top.tool, mode: top.mode, suite: top.suite ?? NO_SUITE, env: top.env } : null;
}

/** Distinct suites of (tool, mode[, env]) that have cases, newest first; the null suite as NO_SUITE. */
export async function suitesByRecency(scope: { tool: string; mode: string; env?: string }): Promise<string[]> {
  const env = scope.env ? sql`AND env = ${scope.env}` : sql``;
  const r = await rows<{ suite: string | null }>(sql`
    SELECT suite FROM eval_run r
    WHERE tool = ${scope.tool} AND mode = ${scope.mode} ${env}
      AND EXISTS (SELECT 1 FROM eval_case c WHERE c.run_id = r.id)
    GROUP BY suite
    ORDER BY max(started_at) DESC
  `);
  return r.map((x) => x.suite ?? NO_SUITE);
}

export interface FilterOptions {
  tools: string[];
  modes: string[];
  suites: string[];
  models: string[];
  envs: string[];
}

type Dim = 'tool' | 'mode' | 'suite' | 'model' | 'env';

/** Distinct values for the filter dropdowns (/runs, /compare), optionally scoped to one tool. One
 * round-trip (a UNION of the dimensions tagged by `k`), grouped back into lists in TS. */
export async function filterOptions(f: Pick<RunFilters, 'tool'> = {}): Promise<FilterOptions> {
  const scoped = f.tool ? sql`WHERE tool = ${f.tool}` : sql``;
  const scopedAnd = f.tool ? sql`AND tool = ${f.tool}` : sql``;
  const all = await rows<{ k: Dim; v: string }>(sql`
    SELECT DISTINCT 'tool'  AS k, tool  AS v FROM eval_run
    UNION ALL SELECT DISTINCT 'mode',  mode  FROM eval_run ${scoped}
    UNION ALL SELECT DISTINCT 'suite', suite FROM eval_run WHERE suite IS NOT NULL ${scopedAnd}
    UNION ALL SELECT DISTINCT 'model', model FROM eval_run ${scoped}
    UNION ALL SELECT DISTINCT 'env',   env   FROM eval_run ${scoped}
    ORDER BY k, v
  `);
  const pick = (k: Dim) => all.filter((r) => r.k === k).map((r) => r.v);
  return { tools: pick('tool'), modes: pick('mode'), suites: pick('suite'), models: pick('model'), envs: pick('env') };
}
