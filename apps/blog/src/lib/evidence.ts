// Build-time evidence loader for the pg_kafka showcase.
//
// pg_kafka isn't a hosted service — its "live" surface is continuously-verified evidence generated
// by pg_kafka's OWN CI (it owns the cached pgrx build + the real-broker compose, like heistmind/bamcp
// own their pipelines) and published to its orphan `evidence` branch. We fetch those artifacts at
// BUILD time and render them server-side (no client JS, in keeping with the rest of the site). If the
// branch isn't populated yet (or the network is unavailable in the build), we fall back to the
// committed seed so the page always renders. Every artifact carries its own `generatedAt`, so a
// slightly stale build is still honest about when the evidence was last verified — the page shows
// that timestamp, not the build time. The page refreshes on the blog's scheduled/triggered redeploy.

import conformanceSeed from '../data/pg-kafka-seed.conformance.json';
import benchSeed from '../data/pg-kafka-seed.bench.json';

// Override in CI/preview to point at a different branch or a local fixture server.
const EVIDENCE_BASE =
  import.meta.env.PG_KAFKA_EVIDENCE_BASE ??
  'https://raw.githubusercontent.com/RTrentJones/pg_kafka/evidence';

const FETCH_TIMEOUT_MS = 5000;

export const REPO_URL = 'https://github.com/RTrentJones/pg_kafka';
export const CODESPACE_URL = 'https://codespaces.new/RTrentJones/pg_kafka';
export const TRACER_TREND_URL = 'https://tracer.rtrentjones.dev/runs?tool=pg_kafka';
export const SESSION_SVG_URL = `${EVIDENCE_BASE}/session.svg`;
/** Committed fallback shipped in apps/blog/public/ — shown until the first CI recording lands. */
export const SESSION_SVG_PLACEHOLDER = '/pg-kafka/session.placeholder.svg';

export type CellStatus = 'pass' | 'fail' | 'na';

export interface ConformanceData {
  generatedAt: string;
  version: string;
  gitSha?: string;
  apis: { key: number; name: string }[];
  clients: { name: string; lang: string; version?: string; results: Record<string, CellStatus> }[];
}

export interface BenchScenario {
  name: string;
  p50Ms: number;
  p99Ms: number;
  msgsPerSec: number;
}
export interface BenchBaseline {
  msgsPerSec: number;
  p50Ms: number;
  p99Ms: number;
}
export interface BenchData {
  generatedAt: string;
  version: string;
  gitSha?: string;
  config: { warmupExcluded: boolean; messageSizes: number[] };
  scenarios: BenchScenario[];
  baselines: { rawInsert: BenchBaseline; realBroker: BenchBaseline };
}

export interface Evidence<T> {
  data: T;
  /** `live` = fetched from the evidence branch; `seed` = committed placeholder. */
  source: 'live' | 'seed';
}

async function load<T>(file: string, seed: T): Promise<Evidence<T>> {
  try {
    const res = await fetch(`${EVIDENCE_BASE}/${file}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { data: seed, source: 'seed' };
    return { data: (await res.json()) as T, source: 'live' };
  } catch {
    return { data: seed, source: 'seed' };
  }
}

export const loadConformance = () =>
  load<ConformanceData>('conformance.json', conformanceSeed as ConformanceData);

export const loadBench = () => load<BenchData>('bench.json', benchSeed as BenchData);

/** Pick the live recording if the evidence branch has one, else the committed placeholder. */
export async function loadSessionSvg(): Promise<{ url: string; source: 'live' | 'seed' }> {
  try {
    const res = await fetch(SESSION_SVG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok) return { url: SESSION_SVG_URL, source: 'live' };
  } catch {
    /* fall through to the placeholder */
  }
  return { url: SESSION_SVG_PLACEHOLDER, source: 'seed' };
}

/** UTC, e.g. "Jun 26, 2026, 12:00 PM". */
export function fmtVerified(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}
