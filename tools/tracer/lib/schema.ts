import { z } from 'zod';
import { REPO_RE } from './signals';

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
const URL_MAX = 2048;
const MAP_KEYS = 64; // metrics/labels maps: enough for a report's headline numbers, not a data dump
// `tool` keys URLs (/projects/<tool>, /api/badge/<tool>) and signal keys, so it is a slug (ASCII \w, '.'
// and '-'). mode/suite/env/model stay free-form: live producers send `api+test`, model labels with
// spaces and parentheses, and free-text env labels.
const TOOL_RE = /^[\w.-]{1,64}$/;

// Numeric metrics (`{ f1: 0.97, msgs_per_sec: 41000 }`): finite numbers only, bounded key count, so a
// producer can't wedge a giant object into jsonb. Keys are short identifiers (dots allowed for
// `step.metric` namespacing).
const metricKey = z.string().min(1).max(80).regex(/^[\w.:/-]+$/);
export const metricsMap = z
  .record(metricKey, z.number().finite())
  .refine((m) => Object.keys(m).length <= MAP_KEYS, `at most ${MAP_KEYS} metrics`);
const labelsMap = z
  .record(metricKey, z.string().max(LABEL_MAX))
  .refine((m) => Object.keys(m).length <= MAP_KEYS, `at most ${MAP_KEYS} labels`);
// A link must be http(s) — it is rendered as an <a href>, so `javascript:` must never round-trip.
const httpUrl = z
  .string()
  .max(URL_MAX)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'must be an http(s) URL');

export const evalCaseInput = z.object({
  // Accepted up to TEXT_MAX; lib/insert-run clips the stored name to LABEL_MAX (never rejected — a long
  // generated case name must not 422 a whole run).
  name: z.string().min(1).max(TEXT_MAX),
  input: z.string().max(TEXT_MAX).nullish(),
  expected: z.string().max(TEXT_MAX).nullish(),
  output: z.string().max(TEXT_MAX).nullish(),
  score: z.number().min(0).max(1).nullish(),
  passed: z.boolean(),
  judge_rationale: z.string().max(TEXT_MAX).nullish(),
  category: z.string().max(LABEL_MAX).nullish(),
  metrics: metricsMap.nullish(),
});

export const evalRunInput = z.object({
  tool: z.string().regex(TOOL_RE, 'tool must match [A-Za-z0-9_.-]{1,64}'),
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
  // Provenance (all optional): which dataset, which repo/branch, and the CI run that produced it.
  suite: z.string().max(LABEL_MAX).nullish(),
  repo: z
    .string()
    .max(LABEL_MAX)
    .regex(REPO_RE, 'owner/name')
    .nullish(),
  branch: z.string().max(LABEL_MAX).nullish(),
  source_url: httpUrl.nullish(),
  metrics: metricsMap.nullish(),
  labels: labelsMap.nullish(),
  // false = "trended, not gated" (shown and trended, never fails the project/badge). Default true.
  gating: z.boolean().optional(),
  cases: z.array(evalCaseInput).max(1000).default([]),
});

export type EvalCaseInput = z.infer<typeof evalCaseInput>;
export type EvalRunInput = z.infer<typeof evalRunInput>;
