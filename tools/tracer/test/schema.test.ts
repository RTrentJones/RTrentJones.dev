import { describe, expect, it } from 'vitest';
import { evalRunInput } from '../lib/schema';

const valid = {
  tool: 'tracer',
  model: 'claude-opus-4-8',
  mode: 'eval',
  env: 'prod',
  passed: true,
  pass_rate: 0.9,
  cases: [{ name: 'case-a', passed: true, score: 0.9, judge_rationale: 'looks right' }],
};

describe('evalRunInput', () => {
  it('accepts a valid payload', () => {
    expect(evalRunInput.safeParse(valid).success).toBe(true);
  });

  it('defaults cases to an empty array', () => {
    const { cases, ...noCases } = valid;
    void cases;
    const parsed = evalRunInput.parse(noCases);
    expect(parsed.cases).toEqual([]);
  });

  it('rejects a missing required field (passed)', () => {
    const { passed, ...rest } = valid;
    void passed;
    expect(evalRunInput.safeParse(rest).success).toBe(false);
  });

  it('rejects a wrong type (passed as string)', () => {
    expect(evalRunInput.safeParse({ ...valid, passed: 'yes' }).success).toBe(false);
  });

  it('rejects pass_rate outside [0,1]', () => {
    expect(evalRunInput.safeParse({ ...valid, pass_rate: 1.5 }).success).toBe(false);
  });

  it('rejects a non-array cases', () => {
    expect(evalRunInput.safeParse({ ...valid, cases: 'nope' }).success).toBe(false);
  });

  it('rejects a case missing its name', () => {
    expect(evalRunInput.safeParse({ ...valid, cases: [{ passed: true }] }).success).toBe(false);
  });
});

// Bounds: every field is length/range-capped so a leaked-token producer can't wedge unbounded text
// into free-tier Neon rows or overflow the numeric(10,4) cost column into a 500.
describe('evalRunInput bounds', () => {
  it('rejects an over-long label field (tool > 255)', () => {
    expect(evalRunInput.safeParse({ ...valid, tool: 'a'.repeat(256) }).success).toBe(false);
    expect(evalRunInput.safeParse({ ...valid, tool: 'a'.repeat(255) }).success).toBe(true);
  });

  it('rejects an over-long case text field (output > 16384)', () => {
    const bad = { ...valid, cases: [{ name: 'c', passed: true, output: 'x'.repeat(16_385) }] };
    expect(evalRunInput.safeParse(bad).success).toBe(false);
    const ok = { ...valid, cases: [{ name: 'c', passed: true, output: 'x'.repeat(16_384) }] };
    expect(evalRunInput.safeParse(ok).success).toBe(true);
  });

  it('rejects more than 1000 cases', () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ name: `c${i}`, passed: true }));
    expect(evalRunInput.safeParse({ ...valid, cases: many }).success).toBe(false);
  });

  it('rejects a negative or overflowing cost_usd', () => {
    expect(evalRunInput.safeParse({ ...valid, cost_usd: -1 }).success).toBe(false);
    expect(evalRunInput.safeParse({ ...valid, cost_usd: 1_000_000 }).success).toBe(false);
    expect(evalRunInput.safeParse({ ...valid, cost_usd: 12.34 }).success).toBe(true);
  });

  it('rejects negative token counts and duration', () => {
    expect(evalRunInput.safeParse({ ...valid, tokens_in: -1 }).success).toBe(false);
    expect(evalRunInput.safeParse({ ...valid, tokens_out: -5 }).success).toBe(false);
    expect(evalRunInput.safeParse({ ...valid, duration_ms: -10 }).success).toBe(false);
  });
});
