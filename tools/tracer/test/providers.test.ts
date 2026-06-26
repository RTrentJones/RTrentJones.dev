import { afterEach, describe, expect, it } from 'vitest';
import { PROVIDERS, costUsd, enabledProviders, pickJudge } from '../lib/providers';

const provider = (id: string) => PROVIDERS.find((p) => p.id === id)!;

const clearKeys = () => {
  for (const p of PROVIDERS) delete process.env[p.envKey];
};
afterEach(clearKeys);

describe('costUsd', () => {
  it('is 0 for a free-tier provider', () => {
    expect(costUsd(provider('gemini'), 1_000_000, 1_000_000)).toBe(0);
  });
  it('uses per-MTok rates for a paid provider', () => {
    // opus: $5/MTok in, $25/MTok out → 1500*5 + 800*25 = 27_500 / 1e6
    expect(costUsd(provider('anthropic'), 1500, 800)).toBeCloseTo(0.0275, 6);
  });
});

describe('enabledProviders (fail-soft on env keys)', () => {
  it('returns only providers whose key is present', () => {
    clearKeys();
    expect(enabledProviders()).toEqual([]);
    process.env.GEMINI_API_KEY = 'x';
    expect(enabledProviders().map((p) => p.id)).toEqual(['gemini']);
  });
});

describe('pickJudge', () => {
  it('is null with no providers', () => {
    clearKeys();
    expect(pickJudge()).toBeNull();
  });
  it('prefers a free OpenAI-compatible judge (gemini)', () => {
    process.env.ANTHROPIC_API_KEY = 'x';
    process.env.GEMINI_API_KEY = 'y';
    expect(pickJudge()?.id).toBe('gemini');
  });
  it('falls back to whatever is enabled', () => {
    clearKeys();
    process.env.ANTHROPIC_API_KEY = 'x';
    expect(pickJudge()?.id).toBe('anthropic');
  });
});
