import { z } from 'zod';

// The ingest contract (POST /api/ingest). One eval_run + its eval_case[]. This is the seam
// `greenlight verify --mode eval` POSTs to. Imported by the route handler AND the test suite so the
// shape stays the single source of truth. `.nullish()` = optional + nullable (callers may send null).
//
// Every field is bounded: this is a public-internet write path (bearer-gated, but a leaked token must
// not let a producer wedge unbounded text into free-tier Neon rows or overflow the numeric column).
// `env`/`mode` stay free-form strings (producer-agnostic — not enum'd) but are length-capped. Text
// fields cap at TEXT_MAX, matching the runtime cap() in lib/insert-run so validation and storage agree.
const TEXT_MAX = 16_384; // ~16 KB per stored text field (input/expected/output/judge_rationale)
const LABEL_MAX = 255; // short identifier columns (tool/model/mode/env)

export const evalCaseInput = z.object({
  name: z.string().min(1).max(LABEL_MAX),
  input: z.string().max(TEXT_MAX).nullish(),
  expected: z.string().max(TEXT_MAX).nullish(),
  output: z.string().max(TEXT_MAX).nullish(),
  score: z.number().min(0).max(1).nullish(),
  passed: z.boolean(),
  judge_rationale: z.string().max(TEXT_MAX).nullish(),
});

export const evalRunInput = z.object({
  tool: z.string().min(1).max(LABEL_MAX),
  model: z.string().min(1).max(LABEL_MAX),
  mode: z.string().min(1).max(LABEL_MAX),
  env: z.string().min(1).max(LABEL_MAX),
  git_sha: z.string().max(120).nullish(),
  duration_ms: z.number().int().nonnegative().nullish(),
  // cost_usd lands in numeric(10,4): cap below 10^6 so an absurd value 422s instead of overflow-500ing.
  cost_usd: z.number().nonnegative().max(999_999).nullish(),
  tokens_in: z.number().int().nonnegative().nullish(),
  tokens_out: z.number().int().nonnegative().nullish(),
  passed: z.boolean(),
  pass_rate: z.number().min(0).max(1).nullish(),
  cases: z.array(evalCaseInput).max(1000).default([]),
});

export type EvalCaseInput = z.infer<typeof evalCaseInput>;
export type EvalRunInput = z.infer<typeof evalRunInput>;
