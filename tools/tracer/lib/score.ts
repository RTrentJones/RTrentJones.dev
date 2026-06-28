// Single source of truth for the eval scoring primitives shared across the ingest mapper
// (lib/openinference), the live eval runner (lib/eval), and the regression deriver (lib/regression).
// Keeping `clamp01`, `PASS_THRESHOLD`, and `passRate` in one place stops the three former copies from
// drifting — in particular, the rule that decides `passed` from a score must be identical on every path.

/** A score is always 0..1; coerce non-numbers / NaN / ±Inf to 0, then clamp into range. */
export const clamp01 = (n: unknown): number => {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
};

/** A case passes when its score reaches this threshold (also the run-level pass/fail rule). */
export const PASS_THRESHOLD = 0.6;

/** Run-level pass_rate from a set of cases: fraction passed, 0 when there are no cases. */
export function passRate(cases: { passed: boolean }[]): number {
  if (cases.length === 0) return 0;
  const passed = cases.reduce((n, c) => n + (c.passed ? 1 : 0), 0);
  return passed / cases.length;
}
