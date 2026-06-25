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
}

// A run annotated with the previous run's pass_rate in its (tool, model, env) series and whether it
// regressed. DERIVED on read — never stored (design §5).
export interface RunWithRegression extends EvalRun {
  prev_pass_rate: number | null;
  is_regression: boolean;
}

export interface PassRatePoint {
  bucket: string; // ISO day
  tool: string;
  model: string;
  pass_rate: number;
  runs: number;
}

export interface RunFilters {
  tool?: string;
  model?: string;
  env?: string;
}

export interface CompareCell {
  model: string;
  pass_rate: number | null;
  name: string; // case name
  score: number | null;
  passed: boolean;
  judge_rationale: string | null;
}
