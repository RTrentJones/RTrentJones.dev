import { describe, expect, it } from 'vitest';
import { type SeriesRun, deriveRegressions } from '../lib/regression';

// The marquee unit: a run is a regression iff its pass_rate dropped vs the immediately-prior run in
// the SAME (tool, model, env) series. Derivation must be order-independent and not cross series.

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
