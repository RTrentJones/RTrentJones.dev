import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROVIDERS, costUsd, enabledProviders, pickJudge } from '../lib/providers';

const provider = (id: string) => PROVIDERS.find((p) => p.id === id)!;

// Snapshot + restore the provider env keys around every test so the suite runs hermetically whether or
// not real keys are present in the ambient env — CI sources GEMINI/ANTHROPIC/XAI as shared secrets, and
// without this the env-dependent assertions below would see them and fail. Each test starts from empty.
const KEYS = PROVIDERS.map((p) => p.envKey);
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

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
    expect(enabledProviders()).toEqual([]);
    process.env.GEMINI_API_KEY = 'x';
    expect(enabledProviders().map((p) => p.id)).toEqual(['gemini']);
  });
});

describe('pickJudge', () => {
  it('is null with no providers', () => {
    expect(pickJudge()).toBeNull();
  });
  it('prefers a free OpenAI-compatible judge (gemini)', () => {
    process.env.ANTHROPIC_API_KEY = 'x';
    process.env.GEMINI_API_KEY = 'y';
    expect(pickJudge()?.id).toBe('gemini');
  });
  it('falls back to whatever is enabled', () => {
    process.env.ANTHROPIC_API_KEY = 'x';
    expect(pickJudge()?.id).toBe('anthropic');
  });

  describe('excludes the provider under test (no self-grading)', () => {
    it('picks another enabled provider over the subject', () => {
      process.env.GEMINI_API_KEY = 'x';
      process.env.ANTHROPIC_API_KEY = 'y';
      // Gemini is the subject → must not judge itself; anthropic is the only other enabled provider.
      expect(pickJudge('gemini')?.id).toBe('anthropic');
    });
    it('still prefers the free judge among the non-subject providers', () => {
      process.env.GEMINI_API_KEY = 'x';
      process.env.XAI_API_KEY = 'y';
      process.env.ANTHROPIC_API_KEY = 'z';
      // Subject is grok → exclude it, then prefer the free OpenAI-compatible judge (gemini).
      expect(pickJudge('grok')?.id).toBe('gemini');
    });
    it('falls back to the subject when it is the only enabled provider', () => {
      process.env.GEMINI_API_KEY = 'x';
      // A self-judge beats no judge at all when nothing else is enabled.
      expect(pickJudge('gemini')?.id).toBe('gemini');
    });
  });
});
