import type { EvalRunInput } from './schema';

// Standards-shaped ingest: accept an OTel-GenAI / OpenInference-flavored verify result and map it to
// the native EvalRunInput. This is the seam a future `greenlight verify --json` (or any OTel-aware
// producer) targets — and, because the contract is the *standard* shape rather than Tracer-bespoke,
// the same payload can be sent to Langfuse/Phoenix instead. Pure + dependency-free so the ingest route
// stays lean and the mapping is unit-testable.

const PASS_THRESHOLD = 0.6;
const clamp01 = (n: unknown): number => {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
};

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

/** Map an OpenInference-shaped verify result to the native EvalRunInput. */
export function fromOpenInference(r: OpenInferenceResult): EvalRunInput {
  const attrs = r.attributes ?? {};
  const cases = r.checks.map((c) => {
    const score = c['eval.score'] == null ? null : clamp01(c['eval.score']);
    return {
      name: c.name,
      input: c.input ?? null,
      expected: c.expected ?? null,
      output: c.output ?? null,
      score,
      passed: c.passed ?? (score == null ? false : score >= PASS_THRESHOLD),
      judge_rationale: c['eval.explanation'] ?? null,
    };
  });
  const passRate =
    r.pass_rate != null
      ? clamp01(r.pass_rate)
      : cases.length === 0
        ? 0
        : cases.filter((c) => c.passed).length / cases.length;

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
    pass_rate: passRate,
    cases,
  };
}
