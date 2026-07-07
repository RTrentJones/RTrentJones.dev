// Verify spec for BAMCP (external MCP server — code in RTrentJones/BAMCP, wrapped here as the
// tools/bamcp submodule). The wrapper owns this spec; `greenlight verify bamcp --env prod` connects
// to bamcp.<domain>/mcp, and `greenlight preview bamcp` runs it against a local container.
//
// ONE config, two contexts (the model's local-gate ↔ prod split):
//  - preview (ctx.preview): the `preview` compose profile serves streamable-http /mcp with
//    auth OFF, so we run an unauthenticated tools/list — no 401, no token.
//  - prod: api 401 (server up + OAuth enforced) + an authenticated tools/list (when the M2M token is
//    set). Telemetry-into-verify attaches the live HTTP response on failure.
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
        { mode: 'api', checks: [{ path: '', status: 401 }], logsOnFailure },
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
