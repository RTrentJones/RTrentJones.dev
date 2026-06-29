import { type SQL, sql } from 'drizzle-orm';
import { getDb } from './db';
import { deriveRegressions } from './regression';
import type {
  CompareCell,
  EvalCase,
  EvalRun,
  PassRatePoint,
  RunFilters,
  RunWithRegression,
} from './types';

// All reads are raw parameterised SQL via Drizzle's `sql` template (auto-parameterised — no
// injection) executed with db.execute(), which returns { rows }. The DISTINCT ON queries are clearer
// as SQL than as the query builder; regressions MUST be derived on read (in TS, see runsWithRegression).

// A v4 UUID is the only valid run id (gen_randomUUID / crypto.randomUUID). Validate before binding it
// into `WHERE id = …`: Postgres would otherwise raise `invalid input syntax for type uuid` on a
// malformed value, surfacing as a misleading "DATABASE_URL misconfigured" boundary instead of a 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rows<T>(query: SQL): Promise<T[]> {
  const res = await getDb().execute(query);
  return res.rows as T[];
}

// Build a WHERE fragment from optional (tool, model, env) filters + an optional recency bound.
// Empty → no clause.
function whereFilters(f: RunFilters, sinceDays?: number): SQL {
  const conds: SQL[] = [];
  if (f.tool) conds.push(sql`tool = ${f.tool}`);
  if (f.model) conds.push(sql`model = ${f.model}`);
  if (f.env) conds.push(sql`env = ${f.env}`);
  if (sinceDays != null) conds.push(sql`started_at >= now() - (${sinceDays}::int * interval '1 day')`);
  return conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
}

/** Most recent run per tool (the dashboard's "latest run per tool" table). */
export function latestRunPerTool(): Promise<EvalRun[]> {
  return rows<EvalRun>(sql`
    SELECT DISTINCT ON (tool) *
    FROM eval_run
    ORDER BY tool, started_at DESC
  `);
}

/** Daily pass-rate per (tool, model) over the last N days — feeds the line chart. */
export function passRateOverTime(days = 30): Promise<PassRatePoint[]> {
  return rows<PassRatePoint>(sql`
    SELECT date_trunc('day', started_at)::date::text AS bucket,
           tool,
           model,
           avg(pass_rate)::real AS pass_rate,
           count(*)::int        AS runs
    FROM eval_run
    WHERE started_at >= now() - (${days}::int * interval '1 day')
      AND pass_rate IS NOT NULL
    GROUP BY 1, tool, model
    ORDER BY 1 ASC
  `);
}

/**
 * Runs (optionally filtered) annotated with regression flags, derived on read by the unit-tested
 * `deriveRegressions` (lib/regression) — the single regression implementation; there is no SQL mirror.
 *
 * The filters (tool/model/env) are exactly the series-key dimensions, so a filter can only drop ENTIRE
 * (tool, model, env) series, never truncate one — every remaining series is complete and its baseline
 * stays correct. We fetch the matching rows oldest-first (with `id` as the equal-timestamp tiebreaker
 * for deterministic ordering), derive, then sort newest-first and take `limit`.
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
  const ordered = await rows<EvalRun>(sql`
    SELECT * FROM eval_run
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

/** Cases for a run, failures first (the interpretability angle: show what broke at the top). */
export function getCases(runId: string): Promise<EvalCase[]> {
  return rows<EvalCase>(sql`
    SELECT * FROM eval_case WHERE run_id = ${runId} ORDER BY passed ASC, name
  `);
}

/**
 * Compare models on the same suite: the latest run per model for (tool, env), with each model's
 * cases. The page pivots these rows into a per-case matrix keyed by case name.
 */
export function compareModels(tool: string, env: string, models: string[]): Promise<CompareCell[]> {
  if (models.length === 0) return Promise.resolve([]);
  const modelList = sql.join(
    models.map((m) => sql`${m}`),
    sql`, `,
  );
  return rows<CompareCell>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (model) id, model, pass_rate
      FROM eval_run
      WHERE tool = ${tool} AND env = ${env} AND model IN (${modelList})
      ORDER BY model, started_at DESC
    )
    SELECT l.model, l.pass_rate, c.name, c.score, c.passed, c.judge_rationale
    FROM latest l
    JOIN eval_case c ON c.run_id = l.id
    ORDER BY c.name, l.model
  `);
}

export interface FilterOptions {
  tools: string[];
  models: string[];
  envs: string[];
}

/** Distinct values for the filter dropdowns (/runs, /compare). One round-trip (a UNION of the three
 * dimensions tagged by `k`) instead of three separate scans; grouped back into the three lists in TS. */
export async function filterOptions(): Promise<FilterOptions> {
  const all = await rows<{ k: 'tool' | 'model' | 'env'; v: string }>(sql`
    SELECT DISTINCT 'tool'  AS k, tool  AS v FROM eval_run
    UNION ALL SELECT DISTINCT 'model', model FROM eval_run
    UNION ALL SELECT DISTINCT 'env',   env   FROM eval_run
    ORDER BY k, v
  `);
  const pick = (k: 'tool' | 'model' | 'env') => all.filter((r) => r.k === k).map((r) => r.v);
  return { tools: pick('tool'), models: pick('model'), envs: pick('env') };
}
