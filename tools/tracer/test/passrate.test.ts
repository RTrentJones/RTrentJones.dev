import { describe, expect, it } from 'vitest';
import { passRate } from '../lib/regression';

describe('passRate', () => {
  it('is 0 for no cases', () => {
    expect(passRate([])).toBe(0);
  });

  it('is 1 when all pass', () => {
    expect(passRate([{ passed: true }, { passed: true }])).toBe(1);
  });

  it('is the passing fraction for a mix', () => {
    expect(passRate([{ passed: true }, { passed: false }, { passed: true }, { passed: false }])).toBe(0.5);
  });
});
