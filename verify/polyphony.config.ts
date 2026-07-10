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

export default (_ctx: VerifyConfigContext) => [
  {
    mode: 'api',
    checks: [
      { path: '', status: 200 },
      { path: '/health', status: 200, contains: '"status"' },
      { path: '/../', status: 200 },
      { path: '/../api/v1/manuscripts/', status: 401 },
      { path: '/../api/v1/scenes/', status: 401 },
      { path: '/../api/v1/books/', status: 401 },
      { path: '/../api/v1/auth/me', status: 401 },
    ],
    // The container runs migrations before serving; give the re-pull + boot time to settle.
    settleRetries: 6,
    settleMs: 5000,
    logsOnFailure,
  },
];
