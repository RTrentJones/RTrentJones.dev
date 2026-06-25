// verifyAll: an array so CI and the agent loop gate on the same harness (allPass).
//  - api: the deployed dashboard renders AND reads Neon. `/` runs a live query, so a broken DB or
//    missing table 500s instead of returning the seeded marker ('claude-opus-4-8'). The ingest route
//    is POST-only, so a GET returns 405 — proving the endpoint is mounted without mutating anything.
//  - test: the tool's Vitest suite (regression logic, pass-rate, ingest zod shape) — no DB needed.
//  - agent-web: DEFERRED. An LLM driving the live UI is config-gated on ANTHROPIC_API_KEY; infra does
//    not wire that key yet, so the entry is omitted (gate stays green on api + test). Pass two adds it.
const anthropic = process.env.ANTHROPIC_API_KEY;

export default [
  {
    mode: 'api',
    checks: [
      // health proves the deployed app can actually reach its DB (DATABASE_URL wired + schema present).
      // This catches the missing-env-var class of failure with a clear signal, not an opaque 500.
      { path: '/api/health', status: 200, contains: '"ok":true' },
      { path: '/', status: 200, contains: 'claude-opus-4-8' },
      { path: '/runs', status: 200 },
      // POST-only route → GET is 405 (Method Not Allowed). Confirms ingest is mounted; the bearer/zod
      // behaviour is covered by the `test` suite and a manual POST smoke (see README).
      { path: '/api/ingest', status: 405 },
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
              task: 'Open the home page and confirm the evals dashboard loads with a pass-rate chart.',
              asserts: [{ selector: 'body' }],
            },
          ],
        },
      ]
    : []),
];
