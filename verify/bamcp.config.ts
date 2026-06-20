// Verify spec for BAMCP (external MCP server — code in RTrentJones/BAMCP, wrapped here as the
// tools/bamcp submodule). Lives in the wrapper because the tool is a registry pointer;
// `greenlight verify bamcp --env beta|prod` connects to bamcp.<domain>/mcp (FastMCP serves
// streamable-HTTP at /mcp by default — the Greenlight convention, already satisfied).
//
// NOTE (refine once live): BAMCP runs with BAMCP_AUTH_ENABLED=true (OAuth) in prod. If the
// server gates the `initialize` handshake itself behind auth, the unauthenticated mcp probe
// below will fail at the handshake — in that case either (a) supply a bearer token to verify,
// or (b) switch to `mode: 'api'` asserting GET /mcp returns 401/405 (proves up + auth-gated).
// Plain `expectTools` works when initialize is allowed unauthenticated (tool *calls* gated).
export default {
  mode: 'mcp',
  expectTools: ['get_variants', 'get_coverage', 'list_contigs', 'visualize_region'],
};
