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
