// Verify spec for BAMCP (external MCP server — code in RTrentJones/BAMCP, wrapped here as the
// tools/bamcp submodule). The wrapper owns this spec; `greenlight verify bamcp --env prod` connects
// to bamcp.<domain>/mcp, and `greenlight preview bamcp` runs it against a local container.
//
// ONE config, two contexts (the model's local-gate ↔ prod split):
//  - preview (ctx.preview): the `preview` compose profile serves streamable-http /mcp with
//    auth OFF, so we run an unauthenticated tools/list — no 401, no token.
//  - prod: api 401 (server up + OAuth enforced) + the OAuth metadata advertises a
//    registration_endpoint (interactive MCP clients — claude.ai's connector — onboard via OAuth
//    Dynamic Client Registration; if it's disabled they can't connect, and the static M2M token
//    below never exercises that path, so this check is the regression guard) + an authenticated
//    tools/list (when the M2M token is set). Telemetry-into-verify attaches the response on failure.
//
// exactTools is the DRIFT GUARD: tools/list must equal TOOLS exactly — a tool added in code but not
// listed here (or removed) FAILS the gate, so a new capability is forced into the verify loop.
import type { VerifyConfigContext } from '@rtrentjones/greenlight';

// `preview` now comes from the verify context (function-shaped config) instead of an eager
// GREENLIGHT_PREVIEW read at module-eval. BAMCP_VERIFY_TOKEN stays an env read — it's a secret,
// not a loop context var.
const token = process.env.BAMCP_VERIFY_TOKEN;
const logsOnFailure = 'curl -sS -i "$GREENLIGHT_VERIFY_URL" 2>&1 | head -30 || true';

const TOOLS = [
  'get_variants',
  'get_coverage',
  'list_contigs',
  'jump_to',
  'visualize_region',
  'get_region_summary',
  'lookup_clinvar',
  'lookup_gnomad',
  'get_variant_curation_summary',
  'search_gene',
  'scan_variants',
  'cleanup_cache',
];

export default ({ preview }: VerifyConfigContext) =>
  preview
    ? [{ mode: 'mcp', expectTools: TOOLS, exactTools: true, logsOnFailure }]
    : [
        {
          mode: 'api',
          checks: [
            // Server up + OAuth enforced.
            { path: '', status: 401 },
            // Interactive onboarding guard: the OAuth authorization-server metadata must advertise
            // a registration_endpoint (i.e. Dynamic Client Registration is enabled), or claude.ai's
            // MCP connector can't register and connect. The verify base is <host>/mcp but discovery
            // lives at the root, so `/../.well-known/...` normalizes back up to <host>/.well-known/...
            {
              path: '/../.well-known/oauth-authorization-server',
              status: 200,
              contains: 'registration_endpoint',
            },
          ],
          logsOnFailure,
        },
        ...(token
          ? [
              {
                mode: 'mcp',
                expectTools: TOOLS,
                exactTools: true,
                headers: { Authorization: `Bearer ${token}` },
              },
            ]
          : []),
      ];
