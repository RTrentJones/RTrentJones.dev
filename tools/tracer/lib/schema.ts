import { z } from 'zod';

// The ingest contract (POST /api/ingest). One eval_run + its eval_case[]. This is the seam
// `greenlight verify --mode eval` POSTs to. Imported by the route handler AND the test suite so the
// shape stays the single source of truth. `.nullish()` = optional + nullable (callers may send null).

export const evalCaseInput = z.object({
  name: z.string().min(1),
  input: z.string().nullish(),
  expected: z.string().nullish(),
  output: z.string().nullish(),
  score: z.number().min(0).max(1).nullish(),
  passed: z.boolean(),
  judge_rationale: z.string().nullish(),
});

export const evalRunInput = z.object({
  tool: z.string().min(1),
  model: z.string().min(1),
  mode: z.string().min(1),
  env: z.string().min(1),
  git_sha: z.string().nullish(),
  duration_ms: z.number().int().nullish(),
  cost_usd: z.number().nullish(),
  tokens_in: z.number().int().nullish(),
  tokens_out: z.number().int().nullish(),
  passed: z.boolean(),
  pass_rate: z.number().min(0).max(1).nullish(),
  cases: z.array(evalCaseInput).default([]),
});

export type EvalCaseInput = z.infer<typeof evalCaseInput>;
export type EvalRunInput = z.infer<typeof evalRunInput>;
