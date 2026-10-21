// Row shapes as returned by the raw-SQL reads in lib/queries.ts (snake_case, straight from Postgres).
// `cost_usd` is a numeric and arrives as a string; `started_at` arrives as an ISO string.

export interface EvalRun {
  id: string;
  tool: string;
  model: string;
  mode: string;
  env: string;
  git_sha: string | null;
  started_at: string;
  duration_ms: number | null;
  cost_usd: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  passed: boolean;
  pass_rate: number | null;
  suite: string | null;
  repo: string | null;
  branch: string | null;
  source_url: string | null;
  metrics: Record<string, number> | null;
  labels: Record<string, string> | null;
  /** false = "trended, not gated": shown and trended, never makes the project/badge/attention fail. */
  gating: boolean;
}

export interface EvalCase {
  id: string;
  run_id: string;
  name: string;
  input: string | null;
  expected: string | null;
  output: string | null;
  score: number | null;
  passed: boolean;
  judge_rationale: string | null;
  category: string | null;
  metrics: Record<string, number> | null;
}

/** The judge (provider/model) changed between a run and its baseline, so their scores aren't comparable. */
export interface JudgeChange {
  from: string;
  to: string;
}

// A run annotated against its BASELINE in its (tool, mode, suite, model, env) series — the latest earlier
// run with a pass_rate that is not incomplete — and whether it regressed. DERIVED on read, never stored
// (design §5); see lib/regression.
export interface RunWithRegression extends EvalRun {
  /** This run's cases whose category is not 'reported' (reported cases are informational, never gated);
   * null when the run has no case rows at all (a run-level-only result). */
  gated_cases: number | null;
  prev_pass_rate: number | null;
  is_regression: boolean;
  baseline_id: string | null;
  incomplete_reason: string | null;
  judge_change: JudgeChange | null;
}

/** Series-dimension filters. `suite === NO_SUITE` (lib/signals) means "suite IS NULL". */
export interface RunFilters {
  tool?: string;
  mode?: string;
  suite?: string;
  model?: string;
  env?: string;
}

export interface CompareCell {
  model: string;
  run_id: string;
  started_at: string;
  git_sha: string | null;
  pass_rate: number | null;
  name: string; // case name
  score: number | null;
  passed: boolean;
  judge_rationale: string | null;
  category: string | null;
}
