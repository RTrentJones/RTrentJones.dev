// verifyAll: an array so CI and the agent loop gate on the same harness (allPass).
//  - api: the deployed dashboard renders AND reads Neon, and the write routes stay locked.
//      /api/health proves DATABASE_URL is wired + the schema is present (ok, runs ≥ 1), and on prod
//      that ingest is still flowing: latestRunAt must be recent, because dogfood-tracer and
//      pg-kafka-tracer both feed prod daily, and a stalled feed otherwise looks perfectly healthy.
//      (Beta gets no scheduled ingest, so freshness is prod-only.) `/` runs live queries, so a broken
//      DB renders error.tsx instead of the heading. An UNAUTHENTICATED POST to /api/ingest and
//      /api/run must be rejected with 401 — the bearer guard is what stops anonymous visitors
//      writing runs or spending provider tokens, so a regression there fails the gate.
//      /__version serves the deployed commit (VERCEL_GIT_COMMIT_SHA); with --expect-sha (promote)
//      requireIdentity makes a missing sha fail rather than read as "unverified".
//  - test: the tool's Vitest suite (regression, pass-rate, judge parse, cost math, OI mapper) — no DB.
//  - agent-web: an LLM drives the live UI. Gated on ANTHROPIC_API_KEY (the Greenlight agent-web driver
//    uses Claude). Omitted when the key is unset.
import type { VerifyConfigContext } from '@rtrentjones/greenlight';

const anthropic = process.env.ANTHROPIC_API_KEY;

export default ({ env }: VerifyConfigContext) => [
  {
    mode: 'api',
    checks: [
      {
        path: '/api/health',
        status: 200,
        json: [
          { path: 'ok', equals: true },
          { path: 'runs', gte: 1 },
          ...(env === 'prod' ? [{ path: 'latestRunAt', maxAgeHours: 50 }] : []),
        ],
      },
      // A heading rendered only after the page's live queries resolve (a DB failure renders error.tsx
      // instead). Not a model name: those come from ingested data, and the old 'claude-opus-4-8'
      // marker went stale when the seeded demo runs were removed (#45).
      { path: '/', status: 200, contains: 'Latest run per tool' },
      { path: '/runs', status: 200 },
      { path: '/compare', status: 200 },
      // Write guards: no credentials sent, so these can never write or spend tokens.
      {
        path: '/api/ingest',
        method: 'POST',
        body: {},
        status: 401,
        json: [{ path: 'error', equals: 'unauthorized' }],
      },
      {
        path: '/api/run',
        method: 'POST',
        body: {},
        status: 401,
        json: [{ path: 'error', equals: 'unauthorized' }],
      },
      // GET on the write routes stays 405 (mounted, POST-only).
      { path: '/api/ingest', status: 405 },
      ...(env === 'preview'
        ? []
        : [{ path: '/__version', status: 200, json: [{ path: 'sha', matches: '^[0-9a-f]{40}$' }] }]),
    ],
    requireIdentity: true,
    settleRetries: 6,
    settleMs: 5000,
  },
  { mode: 'test', command: 'pnpm test' },
  ...(anthropic
    ? [
        {
          mode: 'agent-web',
          scenarios: [
            {
              name: 'dashboard renders',
              task: 'Open the home page and confirm the dashboard loads with a pass-rate-over-time chart and a latest-run-per-tool table.',
              asserts: [{ textContains: 'Project signals' }],
            },
            {
              name: 'run detail surfaces the judge rationale',
              task: 'From the dashboard, open the most recent run by clicking a "detail" link, and confirm the per-case judge rationale is shown.',
              asserts: [{ textContains: 'Judge rationale' }],
            },
            {
              name: 'compare shows models',
              task: 'Open the Compare page and confirm it shows a per-model comparison.',
              asserts: [{ urlContains: '/compare' }],
            },
          ],
        },
      ]
    : []),
];
