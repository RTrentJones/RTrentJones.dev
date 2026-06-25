import { type SQL, sql } from 'drizzle-orm';
import { getDb } from './db';
import type {
  CompareCell,
  EvalCase,
  EvalRun,
  PassRatePoint,
  RunFilters,
  RunWithRegression,
} from './types';

// All reads are raw parameterised SQL via Drizzle's `sql` template (auto-parameterised — no
// injection) executed with db.execute(), which returns { rows }. The window-function and DISTINCT ON
// queries are clearer as SQL than as the query builder, and regressions MUST be derived on read.

async function rows<T>(query: SQL): Promise<T[]> {
  const res = await getDb().execute(query);
  return res.rows as T[];
}

// Build a WHERE fragment from optional (tool, model, env) filters. Empty → no clause.
function whereFilters(f: RunFilters): SQL {
  const conds: SQL[] = [];
  if (f.tool) conds.push(sql`tool = ${f.tool}`);
  if (f.model) conds.push(sql`model = ${f.model}`);
  if (f.env) conds.push(sql`env = ${f.env}`);
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
 * Runs (optionally filtered) annotated with regression flags. The lag() window partitions over the
 * FULL history per (tool, model, env) BEFORE the outer filter, so narrowing the displayed list never
 * corrupts the "previous run" baseline. is_regression is derived here, never stored.
 */
export function runsWithRegression(f: RunFilters = {}, limit = 100): Promise<RunWithRegression[]> {
  return rows<RunWithRegression>(sql`
    WITH ranked AS (
      SELECT r.*,
             lag(r.pass_rate) OVER (
               PARTITION BY r.tool, r.model, r.env
               ORDER BY r.started_at
             ) AS prev_pass_rate
      FROM eval_run r
    )
    SELECT ranked.*,
           (prev_pass_rate IS NOT NULL AND pass_rate IS NOT NULL AND pass_rate < prev_pass_rate)
             AS is_regression
    FROM ranked
    ${whereFilters(f)}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `);
}

/** A single run by id (or null). */
export async function getRun(id: string): Promise<EvalRun | null> {
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

/** Distinct values for the filter dropdowns (/runs, /compare). */
export async function filterOptions(): Promise<FilterOptions> {
  const [tools, models, envs] = await Promise.all([
    rows<{ v: string }>(sql`SELECT DISTINCT tool AS v FROM eval_run ORDER BY 1`),
    rows<{ v: string }>(sql`SELECT DISTINCT model AS v FROM eval_run ORDER BY 1`),
    rows<{ v: string }>(sql`SELECT DISTINCT env AS v FROM eval_run ORDER BY 1`),
  ]);
  return { tools: tools.map((r) => r.v), models: models.map((r) => r.v), envs: envs.map((r) => r.v) };
}
