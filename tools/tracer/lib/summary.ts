import { recentSignalRuns } from './queries';
import { type ProjectHealth, groupSignals, projectHealth, signalLabel } from './signals';

// Machine-readable project status, shared by /api/summary/[tool] and /api/badge/[tool]. Optionally
// narrowed to one signal key, so a README can badge a single suite.

export interface SignalSummary {
  key: string;
  label: string;
  kind: string;
  mode: string;
  suite: string | null;
  env: string;
  model: string;
  passed: boolean;
  pass_rate: number | null;
  is_regression: boolean;
  started_at: string;
  freshness: string;
  run: string; // path to the run page
}

export interface ProjectSummary extends ProjectHealth {
  signals_detail: SignalSummary[];
}

export async function projectSummary(tool: string, signalKey?: string): Promise<ProjectSummary> {
  const all = groupSignals(await recentSignalRuns({ tool }, 2, 180));
  const signals = signalKey ? all.filter((s) => s.key === signalKey) : all;
  return {
    ...projectHealth(tool, signals),
    signals_detail: signals.map((s) => ({
      key: s.key,
      label: signalLabel(s),
      kind: s.kind,
      mode: s.mode,
      suite: s.suite,
      env: s.env,
      model: s.latest.model,
      passed: s.latest.passed,
      pass_rate: s.latest.pass_rate,
      is_regression: Boolean(s.latest.is_regression),
      started_at: s.latest.started_at,
      freshness: s.freshness,
      run: `/runs/${s.latest.id}`,
    })),
  };
}
