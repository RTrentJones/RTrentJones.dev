// Verify spec for Polyphony (external book-writing platform — code in RTrentJones/Polyphony,
// wrapped here as the tools/polyphony submodule). The wrapper owns this spec;
// `greenlight verify polyphony --env prod` runs it against polyphony.<domain>, and
// `greenlight preview polyphony` runs it against the local `preview` compose profile.
//
// Polyphony is NOT an MCP server — lane 'mcp' only gates the oci target — but the mcp lane's
// URL scheme appends /mcp to the base (prod AND preview overrides), and the SHA gate probes
// <base>/__version. The app therefore aliases /mcp, /mcp/health and /mcp/__version, and the
// checks below are written RELATIVE TO THE /mcp BASE:
//  - ''            → /mcp        (alias: app up)
//  - '/health'     → /mcp/health (alias: DB + vector-store checks)
//  - '/../…' paths → dot-segments normalize against the ORIGIN (WHATWG URL), reaching the real
//    routes: the frontend at /, and the JWT-gated API routes which must 401 unauthenticated
//    (registration itself is invite-gated in-app).
import type { VerifyConfigContext } from '@rtrentjones/greenlight';

const logsOnFailure = 'curl -sS -i "$GREENLIGHT_VERIFY_URL/health" 2>&1 | head -30 || true';

export default ({ preview }: VerifyConfigContext) => [
  {
    mode: 'api',
    checks: [
      { path: '', status: 200 },
      // /health reports each dependency. A 200 alone would pass with a degraded vector store, so
      // assert every component: the DB (Neon) and pgvector search both healthy.
      {
        path: '/health',
        status: 200,
        json: [
          { path: 'status', equals: 'healthy' },
          { path: 'checks.database', equals: 'healthy' },
          { path: 'checks.vector_search', equals: 'healthy' },
        ],
      },
      // The DB-free liveness probe the keepalive Worker uses — it must stay up or every keepalive
      // tick would dispatch a self-heal.
      { path: '/health/live', status: 200, json: [{ path: 'status', equals: 'healthy' }] },
      // Artifact identity: the image serves the commit it was built from (the deploy's identity
      // gate waits on it). A local compose build has no sha, so this is deployed-only.
      ...(preview
        ? []
        : [{ path: '/__version', status: 200, json: [{ path: 'sha', matches: '^[0-9a-f]{40}$' }] }]),
      { path: '/../', status: 200 },
      // Was /manuscripts/ (removed in the book-as-root rework — it's /sources/
      // now). The stale check 404'd on the new image and red-failed every deploy.
      { path: '/../api/v1/sources/', status: 401 },
      { path: '/../api/v1/scenes/', status: 401 },
      { path: '/../api/v1/books/', status: 401 },
      { path: '/../api/v1/auth/me', status: 401 },
    ],
    requireIdentity: true,
    // The container runs migrations before serving; give the re-pull + boot time to settle.
    settleRetries: 6,
    settleMs: 5000,
    logsOnFailure,
  },
];
