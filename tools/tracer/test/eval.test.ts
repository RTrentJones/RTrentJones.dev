import { describe, expect, it } from 'vitest';
import { parseJudge } from '../lib/eval';
import { clamp01 } from '../lib/score';

describe('clamp01', () => {
  it('clamps into [0,1] and maps non-finite to 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1); // a 1–5-scale slip is defensively clamped, not trusted
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01('0.25')).toBe(0.25); // string-coerced (judge replies can arrive stringified)
  });
});

describe('parseJudge', () => {
  it('reads score + rationale from a clean JSON reply', () => {
    expect(parseJudge('{"score":0.9,"pass":true,"rationale":"faithful"}')).toEqual({
      score: 0.9,
      rationale: 'faithful',
    });
  });

  it('extracts the JSON object even with surrounding prose', () => {
    expect(parseJudge('Sure! {"score": 0.4, "rationale": "vague"} done').score).toBe(0.4);
  });

  it('clamps an out-of-range score', () => {
    expect(parseJudge('{"score": 1.5, "rationale": "x"}').score).toBe(1);
  });

  it('falls back to `reason` when `rationale` is absent', () => {
    expect(parseJudge('{"score":0.5,"reason":"meh"}').rationale).toBe('meh');
  });

  it('returns a 0 score for an unparseable reply', () => {
    expect(parseJudge('no json here')).toEqual({ score: 0, rationale: 'unparseable judge reply' });
  });
});
