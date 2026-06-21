// Verify spec for BAMCP (external MCP server — code in RTrentJones/BAMCP, wrapped here as the
// tools/bamcp submodule). Lives in the wrapper because the tool is a registry pointer;
// `greenlight verify bamcp --env beta|prod` connects to bamcp.<domain>/mcp.
//
// BAMCP runs with BAMCP_AUTH_ENABLED=true (OAuth) in prod and gates the `initialize` handshake
// itself, so an unauthenticated mcp probe can't list tools. We use `api` mode asserting GET /mcp
// returns 401 — which proves BOTH that the server is up (tunnel + container serving) AND that auth
// is enforced (a public MCP would be a security regression). This is the recommended gate for a
// fully OAuth-gated MCP without managing a bearer token in CI. To assert tool *behavior* later,
// add an mcp-mode spec with a bearer token (verifyAll array).
// NB: the verify base URL is already the connect URL `…/mcp`, so the check path is '' (empty) —
// `{ path: '/mcp' }` would hit `…/mcp/mcp` → 404.
export default {
  mode: 'api',
  checks: [{ path: '', status: 401 }],
};
