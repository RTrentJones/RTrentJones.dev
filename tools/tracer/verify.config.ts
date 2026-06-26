// verifyAll: an array so CI and the agent loop gate on the same harness (allPass).
//  - api: the deployed dashboard renders AND reads Neon. `/api/health` proves DATABASE_URL is wired +
//    schema present; `/` runs a live query (so a broken DB 500s instead of returning the marker). The
//    ingest/run routes are POST-only, so a GET returns 405 — proving they're mounted without mutating.
//  - test: the tool's Vitest suite (regression, pass-rate, judge parse, cost math, OI mapper) — no DB.
//  - agent-web: an LLM drives the live UI. Gated on ANTHROPIC_API_KEY (the Greenlight agent-web driver
//    uses Claude); now wired by infra, so it activates in CI/preview. Omitted when the key is unset.
const anthropic = process.env.ANTHROPIC_API_KEY;

export default [
  {
    mode: 'api',
    checks: [
      { path: '/api/health', status: 200, contains: '"ok":true' },
      { path: '/', status: 200, contains: 'claude-opus-4-8' },
      { path: '/runs', status: 200 },
      { path: '/compare', status: 200 },
      // POST-only routes → GET is 405. Confirms they're mounted; bearer/zod behaviour is covered by the
      // `test` suite + manual POST smoke (see README). (The `api` mode is GET-only, so it can't assert
      // the authed POST path here.)
      { path: '/api/ingest', status: 405 },
      { path: '/api/run', status: 405 },
    ],
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
              task: 'Open the home page and confirm the evals dashboard loads with a pass-rate-over-time chart and a recent-runs table.',
              asserts: [{ textContains: 'Model evals' }],
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
