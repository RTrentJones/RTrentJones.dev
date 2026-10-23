import { describe, expect, it } from 'vitest';
import { type SeriesRun, deriveRegressions, incompleteReason, judgeOf } from '../lib/regression';

// The marquee unit: a run is a regression iff its pass_rate dropped vs its BASELINE — the latest earlier
// complete run with a pass_rate in the SAME (tool, mode, suite, model, env) series. Derivation must be
// order-independent and not cross series.

const run = (over: Partial<SeriesRun> & Pick<SeriesRun, 'started_at' | 'pass_rate'>): SeriesRun => ({
  tool: 'tracer',
  model: 'claude-opus-4-8',
  env: 'prod',
  ...over,
});

const flag = (runs: SeriesRun[]) => {
  const out = deriveRegressions(runs);
  return (started_at: string) => out.find((r) => r.started_at === started_at)!;
};

describe('deriveRegressions', () => {
  it('flags a drop within a series', () => {
    const at = flag([
      run({ started_at: '2026-01-01', pass_rate: 0.95 }),
      run({ started_at: '2026-01-02', pass_rate: 0.8 }),
    ]);
    expect(at('2026-01-02').is_regression).toBe(true);
    expect(at('2026-01-02').prev_pass_rate).toBe(0.95);
  });

  it('never flags the first run in a series', () => {
    const at = flag([run({ started_at: '2026-01-01', pass_rate: 0.5 })]);
    expect(at('2026-01-01').is_regression).toBe(false);
    expect(at('2026-01-01').prev_pass_rate).toBeNull();
  });

  it('does not flag an improvement or an equal pass_rate', () => {
    const at = flag([
      run({ started_at: '2026-01-01', pass_rate: 0.8 }),
      run({ started_at: '2026-01-02', pass_rate: 0.9 }), // up
      run({ started_at: '2026-01-03', pass_rate: 0.9 }), // flat
    ]);
    expect(at('2026-01-02').is_regression).toBe(false);
    expect(at('2026-01-03').is_regression).toBe(false);
  });

  it('is order-independent (sorts each series by started_at)', () => {
    const at = flag([
      run({ started_at: '2026-01-03', pass_rate: 0.7 }),
      run({ started_at: '2026-01-01', pass_rate: 0.95 }),
      run({ started_at: '2026-01-02', pass_rate: 0.9 }),
    ]);
    expect(at('2026-01-02').prev_pass_rate).toBe(0.95); // 0.9 < 0.95 → regression
    expect(at('2026-01-02').is_regression).toBe(true);
    expect(at('2026-01-03').prev_pass_rate).toBe(0.9); // 0.7 < 0.9 → regression
    expect(at('2026-01-03').is_regression).toBe(true);
  });

  it('does not cross-contaminate across model or env', () => {
    const at = flag([
      run({ started_at: '2026-01-01', pass_rate: 0.95 }),
      run({ started_at: '2026-01-02', model: 'claude-haiku-4-5', pass_rate: 0.5 }), // different model
      run({ started_at: '2026-01-02', env: 'beta', pass_rate: 0.5 }), // different env
    ]);
    // Each is the first run in its own series → no regression, no prior.
    const haiku = deriveRegressions([
      run({ started_at: '2026-01-01', pass_rate: 0.95 }),
      run({ started_at: '2026-01-02', model: 'claude-haiku-4-5', pass_rate: 0.5 }),
    ]).find((r) => r.model === 'claude-haiku-4-5')!;
    expect(haiku.is_regression).toBe(false);
    expect(haiku.prev_pass_rate).toBeNull();
    void at;
  });

  it('skips null pass_rate runs when establishing the baseline', () => {
    const at = flag([
      run({ started_at: '2026-01-01', pass_rate: 0.95 }),
      run({ started_at: '2026-01-02', pass_rate: null }), // no rate reported
      run({ started_at: '2026-01-03', pass_rate: 0.8 }), // compares to 0.95, not null
    ]);
    expect(at('2026-01-03').prev_pass_rate).toBe(0.95);
    expect(at('2026-01-03').is_regression).toBe(true);
  });
});

describe('deriveRegressions — series key includes mode and suite', () => {
  it('does not compare across suites of the same tool/model/env', () => {
    const at = flag([
      run({ started_at: '2026-01-01', pass_rate: 1, suite: 'synthetic_v1' }),
      run({ started_at: '2026-01-02', pass_rate: 0.5, suite: 'indel_v1' }),
    ]);
    expect(at('2026-01-02').is_regression).toBe(false);
    expect(at('2026-01-02').prev_pass_rate).toBeNull();
  });

  it('does not compare across modes (signal types) of the same tool', () => {
    const at = flag([
      run({ started_at: '2026-01-01', pass_rate: 1, mode: 'build' }),
      run({ started_at: '2026-01-02', pass_rate: 0, mode: 'verify' }),
    ]);
    expect(at('2026-01-02').is_regression).toBe(false);
  });

  it('still flags a drop within one suite', () => {
    const at = flag([
      run({ started_at: '2026-01-01', pass_rate: 1, mode: 'eval', suite: 'dracula' }),
      run({ started_at: '2026-01-02', pass_rate: 0.75, mode: 'eval', suite: 'dracula' }),
    ]);
    expect(at('2026-01-02').is_regression).toBe(true);
  });
});

describe('deriveRegressions — baseline rule', () => {
  it('never uses an incomplete run as a baseline, and never flags it', () => {
    const out = deriveRegressions([
      run({ id: 'a', started_at: '2026-01-01', pass_rate: 0.9 }),
      run({ id: 'b', started_at: '2026-01-02', pass_rate: 0, labels: { errored: 'outline' } }),
      run({ id: 'c', started_at: '2026-01-03', pass_rate: 0.8 }),
    ]);
    const [a, b, c] = out;
    expect(a.baseline_id).toBeNull();
    expect(b.incomplete_reason).toBe('outline errored');
    expect(b.is_regression).toBe(false); // 0.0 < 0.9, but the run errored
    expect(b.baseline_id).toBe('a');
    expect(c.baseline_id).toBe('a'); // B is skipped
    expect(c.prev_pass_rate).toBe(0.9);
    expect(c.is_regression).toBe(true);
  });

  it('suppresses the regression on a judge change and reports it', () => {
    const out = deriveRegressions([
      run({ started_at: '2026-01-01', pass_rate: 0.9, labels: { judge_provider: 'groq', judge_model: 'llama' } }),
      run({ started_at: '2026-01-02', pass_rate: 0.5, labels: { judge_provider: 'gemini', judge_model: 'flash' } }),
    ]);
    expect(out[1].judge_change).toEqual({ from: 'groq/llama', to: 'gemini/flash' });
    expect(out[1].is_regression).toBe(false);
    expect(out[1].prev_pass_rate).toBe(0.9);
  });

  it('reports no judge change when either side lacks a judge', () => {
    const out = deriveRegressions([
      run({ started_at: '2026-01-01', pass_rate: 0.9 }),
      run({ started_at: '2026-01-02', pass_rate: 0.5, labels: { judge_model: 'flash' } }),
    ]);
    expect(out[1].judge_change).toBeNull();
    expect(out[1].is_regression).toBe(true);
  });

  it('marks a run that scored nothing as incomplete', () => {
    const out = deriveRegressions([
      run({ started_at: '2026-01-01', mode: 'eval', pass_rate: 0.9, gated_cases: 3 }),
      run({ started_at: '2026-01-02', mode: 'eval', pass_rate: 0, gated_cases: 0 }),
    ]);
    expect(out[1].incomplete_reason).toBe('no scored cases');
    expect(out[1].is_regression).toBe(false);
  });

  it('treats a run with no case rows (gated_cases null) as a complete run-level result', () => {
    const out = deriveRegressions([
      run({ started_at: '2026-01-01', mode: 'benchmark', pass_rate: 0.9, gated_cases: null }),
      run({ started_at: '2026-01-02', mode: 'benchmark', pass_rate: 0.7, gated_cases: null }),
    ]);
    expect(out.map((r) => r.incomplete_reason)).toEqual([null, null]);
    expect(out[1]).toMatchObject({ prev_pass_rate: 0.9, is_regression: true });
  });

  it('never marks a pipeline run with a null pass_rate incomplete', () => {
    const out = deriveRegressions([run({ started_at: '2026-01-01', mode: 'deploy', pass_rate: null, gated_cases: 0 })]);
    expect(out[0].incomplete_reason).toBeNull();
  });

  it('preserves input order', () => {
    const rs = [
      run({ id: 'x', started_at: '2026-01-03', pass_rate: 0.7 }),
      run({ id: 'y', started_at: '2026-01-01', pass_rate: 0.9 }),
    ];
    expect(deriveRegressions(rs).map((r) => r.id)).toEqual(['x', 'y']);
    expect(deriveRegressions(rs)[0].baseline_id).toBe('y');
  });
});

describe('incompleteReason', () => {
  it('joins errored and skipped steps', () => {
    expect(incompleteReason({ pass_rate: 1, labels: { errored: 'outline,prose', skipped: 'judge' } })).toBe(
      'outline, prose errored; judge skipped',
    );
  });

  it('only reports "no scored cases" when no step label applies', () => {
    expect(incompleteReason({ mode: 'eval', pass_rate: 0, gated_cases: 0, labels: { skipped: 'x' } })).toBe(
      'x skipped',
    );
    expect(incompleteReason({ mode: 'eval', pass_rate: null, gated_cases: 0 })).toBeNull();
    expect(incompleteReason({ mode: 'eval', pass_rate: 1, gated_cases: null })).toBeNull();
    expect(incompleteReason({ mode: 'build', pass_rate: 1, gated_cases: 0 })).toBeNull();
    expect(incompleteReason({ mode: 'eval', pass_rate: 1, gated_cases: 2 })).toBeNull();
  });

  it('ignores empty step labels', () => {
    expect(incompleteReason({ pass_rate: 1, labels: { errored: ' , ' } })).toBeNull();
  });
});

describe('judgeOf', () => {
  it('formats provider/model, or whichever half is present', () => {
    expect(judgeOf({ judge_provider: 'groq', judge_model: 'llama' })).toBe('groq/llama');
    expect(judgeOf({ judge_provider: 'groq' })).toBe('groq');
    expect(judgeOf({ judge_model: 'llama' })).toBe('llama');
    expect(judgeOf({})).toBeNull();
    expect(judgeOf(null)).toBeNull();
  });
});
