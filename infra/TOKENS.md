# Apply tokens & values for this repo

The Terraform in `infra/` now manages **three** tools — HeistMind (Supabase + Vercel + DNS + keepalive),
tracer (Neon + Vercel + DNS), and BAMCP (OCI). This is the single source of truth for the secrets/vars
`.github/workflows/infra.yml` reads at `terraform apply`. **Keep it in sync with that workflow's `env:`
block** — every name below is referenced there.

**How to get each token (generic):** see the framework guide →
[Greenlight `docs/provider-tokens.md`](https://github.com/RTrentJones/greenlight/blob/main/docs/provider-tokens.md)
(Cloudflare needs **Workers Scripts: Edit** + **Zone DNS: Edit** + **Tunnel: Edit** for bamcp; Supabase =
Management API token; Vercel = team-scoped token).

Secrets live **only as GitHub Actions secrets** — Greenlight keeps no local secret file. Set/rotate with
`gh secret set <NAME>` (value on stdin) or `greenlight secrets gather <tool>` (hidden input, pushed
straight to GitHub, never to disk). Enumerable IDs (zone/account/project) are repo **variables**
(`gh variable set`), not secrets.

## Non-secret IDs already wired in

| thing | value |
|---|---|
| Cloudflare account | `47f5715fc54e2280476f65d03cce71f5` |
| Cloudflare zone (`rtrentjones.dev`) | `9c07f36cb8f4f19f577193de79500896` (repo var `CLOUDFLARE_ZONE_ID` → `TF_VAR_cloudflare_zone_id`) |
| Supabase org (RTJ) | `kvscndbazripnyavwjkq` |
| Supabase project (`heistmind-db`) | `kjcdddzyibwqahgiypdb` |
| Vercel team | `team_43JnQTGSMAIlMIVyBuOjiS8W` |
| Vercel project (`heist-mind-web`) | `prj_QF5mBjNr8sw0F8wckqWdfw1vCI2X` |

tracer's Vercel project id and Neon project id are **non-secret HCP workspace variables** (set on the
`rtrentjones-dev` workspace), not GitHub secrets.

## Secrets to set (GitHub Actions secrets on this repo)

Backend + provider auth (shared):

```sh
TF_API_TOKEN                       # HCP Terraform — state backend + locking
CLOUDFLARE_API_TOKEN               # Workers Scripts:Edit + Zone DNS:Edit (+ Tunnel:Edit for bamcp)
VERCEL_API_TOKEN                   # team-scoped (heistmind + tracer projects)
SUPABASE_ACCESS_TOKEN              # Management API token (heistmind)
NEON_API_KEY                       # neon provider reads this natively (tracer)
```

HeistMind (`TF_VAR_HEISTMIND_*`):

```sh
TF_VAR_HEISTMIND_SUPABASE_DATABASE_PASSWORD   # ignored on the imported project; ≥4 chars (or unset → 'import-placeholder')
TF_VAR_HEISTMIND_GITHUB_ADMIN_TOKEN           # administration:write → manages the prod ship-gate (branch protection)
TF_VAR_HEISTMIND_DISCORD_CLIENT_ID            # Supabase Discord OAuth (optional → auth disabled)
TF_VAR_HEISTMIND_DISCORD_CLIENT_SECRET
VERCEL_AUTOMATION_BYPASS_SECRET_HEISTMIND     # lets the authenticated Playwright deploy-gate bypass Vercel protection
```

tracer (`TF_VAR_TRACER_*` + shared LLM keys): the ingest token is tracer-specific; the LLM keys reuse
the **shared account secrets** (`infra.yml` maps `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`XAI_API_KEY` →
`TF_VAR_tracer_*`, so there's no duplicate to set). All optional → an unset key fails that capability
closed.

```sh
TF_VAR_TRACER_INGEST_TOKEN         # bearer for POST /api/ingest + /api/run (fails closed if unset)
ANTHROPIC_API_KEY                  # shared → TF_VAR_tracer_anthropic_api_key (paid; makes /api/run spend)
GEMINI_API_KEY                     # shared → TF_VAR_tracer_gemini_api_key (free tier; $0 runs)
XAI_API_KEY                        # shared → TF_VAR_tracer_xai_api_key
```

BAMCP (OCI auth + verify):

```sh
TF_VAR_OCI_TENANCY_OCID
TF_VAR_OCI_USER_OCID
TF_VAR_OCI_FINGERPRINT
TF_VAR_OCI_PRIVATE_KEY             # PEM
TF_VAR_OCI_REGION                  # e.g. us-phoenix-1
TF_VAR_OCI_COMPARTMENT_ID          # optional → falls back to tenancy/root
BAMCP_VERIFY_TOKEN                 # M2M token for the authenticated mcp verify (optional → 401 smoke gates)
GREENLIGHT_STATUS_TOKEN_BAMCP      # PAT to post commit status back to RTrentJones/BAMCP (deploy workflow)
```

keepalive:

```sh
TF_VAR_KEEPALIVE_GITHUB_TOKEN      # Issues:write (alerts) + Contents:write (auto-heal dispatch); optional
```

## Apply

Normal applies run in **CI** — push to `main` with changes under `infra/**` and `infra.yml` runs
`plan` → (manual approval, `prod` environment) → `apply`, with the GitHub Actions secrets above. The
plan job fails fast if it would destroy a stateful prod store (the destroy plan-guard).

The initial Supabase **import** was a one-time bootstrap (the project pre-existed). If it ever needs
re-running, do it as a single shell session with the tokens exported in-process (never a committed
file) — or via a `workflow_dispatch` of `infra.yml`:

```sh
export CLOUDFLARE_API_TOKEN=… SUPABASE_ACCESS_TOKEN=… VERCEL_API_TOKEN=… \
  TF_VAR_cloudflare_zone_id=9c07f36cb8f4f19f577193de79500896 \
  TF_VAR_heistmind_supabase_database_password=import-placeholder
terraform -chdir=infra init
terraform -chdir=infra import module.heistmind_supabase.supabase_project.this kjcdddzyibwqahgiypdb
terraform -chdir=infra plan       # review — nothing should destroy the DB (ignore_changes guards it)
terraform -chdir=infra apply      # vercel env+domain, DNS CNAME, keepalive worker+cron
```
