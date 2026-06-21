// Verify spec for BAMCP (external MCP server — code in RTrentJones/BAMCP, wrapped here as the
// tools/bamcp submodule). `greenlight verify bamcp --env beta|prod` connects to bamcp.<domain>/mcp.
//
// An ARRAY (verifyAll / allPass) combines two signals:
//  1. api — always runs. GET <base>/mcp must 401, proving the server is up (tunnel + container
//     serving) AND OAuth is enforced (a public MCP would be a security regression). Base path is
//     '' since the verify base URL is already the …/mcp connect URL ('/mcp' would hit …/mcp/mcp).
//  2. mcp (functional / "eval") — runs ONLY when BAMCP_VERIFY_TOKEN is set: an authenticated
//     initialize → tools/list asserting the real tools are registered + callable. Token is injected
//     from the env (never committed); absent → this spec is omitted so the gate stays green on the
//     401 alone until a CI token is provisioned (BAMCP OAuth client-credentials → wrapper secret).
const token = process.env.BAMCP_VERIFY_TOKEN;

export default [
  { mode: 'api', checks: [{ path: '', status: 401 }] },
  ...(token
    ? [
        {
          mode: 'mcp',
          expectTools: ['get_variants', 'get_coverage', 'list_contigs', 'visualize_region'],
          headers: { Authorization: `Bearer ${token}` },
        },
      ]
    : []),
];
