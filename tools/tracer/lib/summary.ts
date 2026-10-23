import { recentSignalRuns } from './queries';
import {
  type Cadence,
  type ProjectHealth,
  type SignalState,
  groupSignals,
  headlineMetric,
  projectHealth,
  signalLabel,
  signalStatus,
} from './signals';
import type { JudgeChange } from './types';

// Machine-readable project status, shared by /api/summary/[tool] and /api/badge/[tool] — and the read
// contract producers use (e.g. de-duplication by `git_sha`). Optionally narrowed to one signal key
// (`tool|mode|suite|env`, empty suite segment for null), so a README can badge a single suite. Uses the
// overview's window and the one status rule (lib/signals), so the summary never disagrees with the page.

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
  gating: boolean;
  state: SignalState;
  counted: boolean;
  cadence: Cadence;
  incomplete_reason: string | null;
  judge_change: JudgeChange | null;
  git_sha: string | null;
  headline: { key: string; value: number; unit: string | null } | null;
}

export interface ProjectSummary extends ProjectHealth {
  signals_detail: SignalSummary[];
}

export async function projectSummary(tool: string, signalKey?: string): Promise<ProjectSummary> {
  const all = groupSignals(await recentSignalRuns({ tool }, 20, 180));
  const signals = signalKey ? all.filter((s) => s.key === signalKey) : all;
  return {
    ...projectHealth(tool, signals, { explicit: Boolean(signalKey) }),
    signals_detail: signals.map((s) => {
      const st = signalStatus(s);
      return {
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
        gating: s.gating,
        state: st.state,
        counted: st.counted,
        cadence: s.cadence,
        incomplete_reason: s.latest.incomplete_reason ?? null,
        judge_change: s.latest.judge_change ?? null,
        git_sha: s.latest.git_sha ?? null,
        headline: headlineMetric(s.latest),
      };
    }),
  };
}
