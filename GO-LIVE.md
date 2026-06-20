# Greenlight ecosystem — full go-live runbook (all projects)

Every config + action remaining to get the whole stack fully up and running. Ordered by
dependency: **publish the framework → switch the wrapper to npm → BAMCP live → validation polish**.

**Legend:** 🔑 auth/secret · 👤 manual (provider console) · ⚙️ config/edit · ▶️ command/action

## Status snapshot
| Project | State | Remaining |
|---|---|---|
| Blog (`rtrentjones.dev`) | ✅ live (Workers/wrangler) | nothing (optional: fold into the verify loop) |
| HeistMind (`heistmind.…`) | ✅ live (Vercel + Supabase, kept alive) | Phase D (agentic validation, optional) |
| BAMCP (`bamcp.…`) | ⏳ onboarded, not live | Phase C |
| Greenlight framework | ✅ `main` @ v0.2.4 (not on npm) | Phase A |

---

## Phase A — Publish the framework to npm
*Unblocks everything that runs `greenlight` from a consumer (the wrapper, tool repos).*

**One published package** — `@rtrentjones/greenlight` (the CLI; the libs are bundled in,
keepalive is a TF-only Worker), at **0.2.4** (done, in the repo). Publishing is **OIDC Trusted
Publishing** from CI — no `NPM_TOKEN`, no automation token.

1. 🔑 **Configure the trusted publisher on npm** for `@rtrentjones/greenlight`: npmjs.com →
   the package's Settings → **Trusted Publisher** → GitHub Actions → org `RTrentJones`, repo
   `greenlight`, workflow `release.yml`. (npm lets you add this for a not-yet-published name; the
   first OIDC publish creates the package.)
2. ▶️ **Publish**: trigger the workflow — `gh workflow run release.yml -R RTrentJones/greenlight`
   (or push a `v*` tag). It builds + publishes `@rtrentjones/greenlight@0.2.4` via OIDC.
   - *Fallback if npm won't pre-configure a new name:* one interactive bootstrap publish from your
     terminal — `cd ~/workspace/Greenlight && pnpm --filter @rtrentjones/greenlight publish
     --access public --no-git-checks` (enter the emailed OTP) — then enable trusted publishing.
3. ▶️ **Verify**: `npm view @rtrentjones/greenlight version` → `0.2.4`.

## Phase B — Switch the wrapper to the one npm dep
*Replaces the vendored 0.1.0 tarballs (no OCI adapter) with published v0.2.4.*

4. ⚙️ In `~/workspace/RTrentJones.dev/package.json`, replace the 5 `@rtrentjones/greenlight*`
   `file:vendor/*.tgz` deps with a **single** `"@rtrentjones/greenlight": "^0.2.4"`, and **delete
   the `pnpm.overrides`** for them. Point `greenlight.config.ts`'s import at `@rtrentjones/greenlight`.
5. ▶️ `rm -rf vendor && pnpm install` (incremental — node_modules present — to avoid the WSL OOM).
6. ▶️ Sanity: `pnpm exec greenlight --help` shows the current CLI (with `deploy` oci support).

## Phase C — BAMCP live (OCI Container Instance)

### C1. OCI creds (free tier — NO PAYG)
9. 👤 At cloud.oracle.com (stay on the free tier): **profile → User settings → Tokens and keys →
   Add API key** — capture **tenancy OCID, user OCID, fingerprint, private key (PEM), region**.
   Note a **compartment OCID + availability domain + a public subnet OCID** (VCN "Internet
   Connectivity" wizard if you have none). Always-Free A1 Container Instance; no PAYG.

### C2. Cloudflare (🔑)
12. 🔑 Add **Account → Cloudflare Tunnel → Edit** to `CLOUDFLARE_API_TOKEN` (keep Zone:DNS:Edit);
    update `.greenlight/secrets.env` + `greenlight secrets sync`. The current token can't create
    the tunnel.

### C3. Wrapper config edits (⚙️)
13. ⚙️ **Fill BAMCP's runtime env** in `infra/bamcp.tf` (`module "bamcp_instance"` → `environment`):
    ```hcl
    environment = {
      BAMCP_TRANSPORT = "streamable-http", BAMCP_HOST = "0.0.0.0", BAMCP_PORT = "8000",
      BAMCP_AUTH_ENABLED = "true", BAMCP_ISSUER_URL = "https://bamcp.rtrentjones.dev",
      BAMCP_RESOURCE_SERVER_URL = "https://bamcp.rtrentjones.dev",
      BAMCP_ALLOW_REMOTE_FILES = "true", BAMCP_RATE_LIMIT = "60"
    }
    ```
14. ▶️ **TF lockfile**: `terraform -chdir=infra init` (adds `oci` + `random`); commit
    `infra/.terraform.lock.hcl`.

### C4. Secrets → GitHub (one guided CLI, no disk/logs)
15. 🔑 `greenlight secrets gather bamcp --repo RTrentJones/RTrentJones.dev` — prints each token's
    create-it link + scopes, hidden-prompts, pushes straight to the wrapper's GitHub secrets (value
    on stdin, never logged). Fill the **8 `TF_VAR_OCI_*`** + **`GREENLIGHT_STATUS_TOKEN`**; press
    Enter to skip the rest. (The deploy listener reuses the same `TF_VAR_OCI_*` for the OCI CLI —
    no separate `OCI_CLI_*` set.)
16. 🔑 `greenlight secrets gather bamcp --repo RTrentJones/BAMCP` — fill **`GREENLIGHT_DISPATCH_TOKEN`**
    (PAT, Contents:write on the wrapper); skip the rest.

### C5. Image + apply (▶️ / ⚙️)
17. ▶️ **Merge BAMCP PR #20** → `greenlight-build.yml` builds + pushes
    `ghcr.io/rtrentjones/bamcp:prod`.
18. ⚙️ **Make the GHCR package public** (or add `image_pull_secrets` to the module for private).
19. ▶️ **Bump the submodule pointer**: `git submodule update --remote tools/bamcp &&
    git add tools/bamcp && git commit -m "chore: bump bamcp submodule"`.
20. ▶️ **Promote `develop` → `main`** (FF or run `infra.yml`) → `terraform apply` creates the
    tunnel + A1 container instance (pulls + runs the image) + DNS → **BAMCP live**.
21. 🔑 Set `BAMCP_OCI_CONTAINER_INSTANCE_OCID` (wrapper secret) from the `bamcp_container_instance_id`
    Terraform output.
22. ▶️ **Verify**: `greenlight verify bamcp --env prod`. If OAuth gates `initialize`, refine
    `verify/bamcp.config.ts` per its NOTE (token, or `api`-mode 401).
23. ⚙️ **Keepalive**: in `infra/heistmind.tf`'s `module.keepalive.targets_json`, append
    `{ name = "bamcp", env = "prod", url = module.bamcp_dns.prod_url, kind = "oci" }`.
24. ⚙️ **Cleanup**: delete BAMCP's legacy `deploy.yml` (OCIR + OCI creds in the tool repo).

## Phase D — Validation polish (optional, makes the loop "fully" real)
25. 🔑 **HeistMind agent-web**: to run the LLM UI validation, set `ANTHROPIC_API_KEY` + install
    `@anthropic-ai/sdk`, then add an `agent-web` spec to its verify config. (Or wait for the
    backlogged Claude-Code-subscription driver — no API key.)
26. ⚙️ **`test`/`eval` modes**: add a `test`-mode spec where a tool has its own test suite
    (e.g. BAMCP `pytest`); `eval`-mode for MCP quality once worth it.

## Phase E — Liveness confirm
27. ✅ HeistMind Supabase already in keepalive. After C, BAMCP is too (step 23). Blog needs none
    (Workers don't pause). Confirm the keepalive worker's alert sink is wired.

---

## Auth / secrets master inventory
| Secret | Where | Phase | Purpose |
|---|---|---|---|
| npm trusted publisher (OIDC) | npmjs.com package settings | A | publish via CI, no token |
| `TF_VAR_oci_*` (8) | wrapper repo | C | `terraform apply` (oci provider + placement) |
| `OCI_CLI_*` (5) | wrapper repo | C | deploy listener restart (oci CLI) |
| `BAMCP_OCI_CONTAINER_INSTANCE_OCID` | wrapper repo | C | which instance to restart (post-apply) |
| `GREENLIGHT_STATUS_TOKEN` (PAT) | wrapper repo | C | deploy status → BAMCP commit |
| `GREENLIGHT_DISPATCH_TOKEN` (PAT) | BAMCP repo | C | fire deploy dispatch → wrapper |
| `CLOUDFLARE_API_TOKEN` (+ Tunnel:Edit) | wrapper repo + `.greenlight/secrets.env` | C | tunnel + DNS apply |
| `ANTHROPIC_API_KEY` | wrapper / CI | D (optional) | agent-web / eval verify |
| existing: `TF_API_TOKEN`, Supabase/Vercel tokens | wrapper repo | — | HCP backend + HeistMind |

## Adding more tools later
Each new subdomain tool = one `greenlight adopt <name> --repo <url> --lane <l> --target <t>` (or
`add` for a local tool), then its slice of Phase C (its provider's creds + secrets). The framework
+ wrapper plumbing is now in place, so it's per-tool config, not new infrastructure.
