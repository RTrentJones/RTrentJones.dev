import type { EvalRunInput } from './schema';
import { PASS_THRESHOLD, clamp01, passRate } from './score';

// Standards-shaped ingest: accept an OTel-GenAI / OpenInference-flavored verify result and map it to
// the native EvalRunInput. This is the seam a future `greenlight verify --json` (or any OTel-aware
// producer) targets — and, because the contract is the *standard* shape rather than Tracer-bespoke,
// the same payload can be sent to Langfuse/Phoenix instead. Pure + dependency-free so the ingest route
// stays lean and the mapping is unit-testable.

interface OICheck {
  name: string;
  passed?: boolean;
  input?: string | null;
  expected?: string | null;
  output?: string | null;
  // OpenInference eval attributes (per check/span):
  'eval.score'?: number | null; // 0..1
  'eval.explanation'?: string | null;
}

export interface OpenInferenceResult {
  tool: string;
  mode?: string;
  env?: string;
  git_sha?: string | null;
  duration_ms?: number | null;
  passed: boolean;
  pass_rate?: number | null;
  // OTel-GenAI span attributes for the run:
  attributes?: {
    'gen_ai.request.model'?: string;
    'gen_ai.usage.input_tokens'?: number;
    'gen_ai.usage.output_tokens'?: number;
    'gen_ai.response.cost'?: number;
  };
  checks: OICheck[];
}

/** Distinguish the standard shape from the native EvalRunInput (which carries `cases`, not `checks`). */
export function isOpenInferenceResult(body: unknown): body is OpenInferenceResult {
  return Boolean(
    body &&
      typeof body === 'object' &&
      Array.isArray((body as { checks?: unknown }).checks) &&
      typeof (body as { tool?: unknown }).tool === 'string',
  );
}

/** Map an OpenInference-shaped verify result to the native EvalRunInput. Never throws: a malformed or
 * null `checks` element (a producer bug) is coerced to a safe empty case rather than crashing ingest. */
export function fromOpenInference(r: OpenInferenceResult): EvalRunInput {
  const attrs = r.attributes ?? {};
  const cases = r.checks.map((raw) => {
    // Defensive: `checks` is external input — guard a non-object/null element before reading fields.
    const c: OICheck = raw && typeof raw === 'object' ? raw : ({ name: 'unknown' } as OICheck);
    const score = c['eval.score'] == null ? null : clamp01(c['eval.score']);
    return {
      name: typeof c.name === 'string' && c.name ? c.name : 'unknown',
      input: c.input ?? null,
      expected: c.expected ?? null,
      output: c.output ?? null,
      score,
      passed: c.passed ?? (score == null ? false : score >= PASS_THRESHOLD),
      judge_rationale: c['eval.explanation'] ?? null,
    };
  });
  const runPassRate = r.pass_rate != null ? clamp01(r.pass_rate) : passRate(cases);

  return {
    tool: r.tool,
    model: attrs['gen_ai.request.model'] ?? 'unknown',
    mode: r.mode ?? 'eval',
    env: r.env ?? 'prod',
    git_sha: r.git_sha ?? null,
    duration_ms: r.duration_ms ?? null,
    cost_usd: attrs['gen_ai.response.cost'] ?? null,
    tokens_in: attrs['gen_ai.usage.input_tokens'] ?? null,
    tokens_out: attrs['gen_ai.usage.output_tokens'] ?? null,
    passed: r.passed,
    pass_rate: runPassRate,
    cases,
  };
}
