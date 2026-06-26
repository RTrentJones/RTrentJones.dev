import { describe, expect, it } from 'vitest';
import { fromOpenInference, isOpenInferenceResult } from '../lib/openinference';

describe('isOpenInferenceResult', () => {
  it('detects the standard shape (has tool + checks)', () => {
    expect(isOpenInferenceResult({ tool: 't', passed: true, checks: [] })).toBe(true);
  });
  it('rejects the native shape (has cases, not checks)', () => {
    expect(isOpenInferenceResult({ tool: 't', model: 'm', cases: [] })).toBe(false);
  });
  it('rejects junk', () => {
    expect(isOpenInferenceResult(null)).toBe(false);
    expect(isOpenInferenceResult({ checks: [] })).toBe(false); // no tool
  });
});

describe('fromOpenInference', () => {
  const sample = {
    tool: 'tracer',
    mode: 'agent-web',
    env: 'beta',
    git_sha: 'abc1234',
    duration_ms: 4200,
    passed: true,
    attributes: {
      'gen_ai.request.model': 'claude-sonnet-4-6',
      'gen_ai.usage.input_tokens': 1500,
      'gen_ai.usage.output_tokens': 800,
      'gen_ai.response.cost': 0.012,
    },
    checks: [
      { name: 'home renders', 'eval.score': 1, 'eval.explanation': 'loaded', passed: true, output: 'ok' },
      { name: 'flaky', 'eval.score': 0.3, 'eval.explanation': 'partial' }, // passed derived from score
    ],
  };

  it('maps OTel-GenAI attributes onto the run', () => {
    const r = fromOpenInference(sample);
    expect(r.model).toBe('claude-sonnet-4-6');
    expect(r.tokens_in).toBe(1500);
    expect(r.tokens_out).toBe(800);
    expect(r.cost_usd).toBe(0.012);
    expect(r.mode).toBe('agent-web');
    expect(r.env).toBe('beta');
  });

  it('maps checks → cases with score/rationale and derives passed from score', () => {
    const r = fromOpenInference(sample);
    expect(r.cases).toHaveLength(2);
    expect(r.cases[0]).toMatchObject({ name: 'home renders', score: 1, passed: true, judge_rationale: 'loaded' });
    expect(r.cases[1]).toMatchObject({ name: 'flaky', score: 0.3, passed: false, judge_rationale: 'partial' });
  });

  it('derives pass_rate when absent', () => {
    expect(fromOpenInference(sample).pass_rate).toBe(0.5); // 1 of 2 passed
  });

  it('clamps out-of-range scores and defaults a missing model', () => {
    const r = fromOpenInference({ tool: 'x', passed: false, checks: [{ name: 'c', 'eval.score': 9 }] });
    expect(r.model).toBe('unknown');
    expect(r.cases[0].score).toBe(1);
  });
});
