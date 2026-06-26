# HeistMind — Vercel + Supabase + keepalive, configured from this wrapper (app code stays
# in RTrentJones/HeistMind, which deploys via Vercel's git integration). Centralizing this
# is the fix for the Supabase pause that took it down: declarative + recreatable + kept alive.
#
# APPLIED (2026-06): live as of v0.2.2. The keepalive module is self-contained (ships its
# own bundled worker.js), so no local build is needed. To re-apply from a fresh clone:
# │  1. Creds (see infra/TOKENS.md / Greenlight docs/provider-tokens.md): SUPABASE_ACCESS_TOKEN,
# │     VERCEL_API_TOKEN, a CLOUDFLARE_API_TOKEN with **Workers Scripts: Edit + Zone DNS: Edit**,
# │     and TF_VAR_cloudflare_zone_id / TF_VAR_heistmind_supabase_database_password.
# │  2. The live Supabase project is imported (not recreated — name/region are replace-forcing
# │     and the module sets ignore_changes). On a fresh state, re-import before apply:
# │       terraform import module.heistmind_supabase.supabase_project.this kjcdddzyibwqahgiypdb
# │     (The Vercel module manages only domains + env on the EXISTING project by id — nothing to import.)
# │  3. Apply is currently run manually (state is local). CI apply-on-push needs R2 remote state.

provider "vercel" {
  # api_token from VERCEL_API_TOKEN; scope all resources to the team.
  team = "team_43JnQTGSMAIlMIVyBuOjiS8W"
}

provider "supabase" {
  # access_token from the SUPABASE_ACCESS_TOKEN environment variable.
}

variable "heistmind_supabase_database_password" {
  type      = string
  sensitive = true
  default   = "import-placeholder" # ≥4 chars, so an unset/dummy secret can't fail plan validation
  # heistmind-db is imported and the module pins ignore_changes on the password, so this is NEVER
  # written to the live DB. Set TF_VAR_HEISTMIND_SUPABASE_DATABASE_PASSWORD (any dummy ≥4 chars) to
  # override the default; only a real from-scratch recreate needs the genuine password.
}

# Discord OAuth creds (scoped secrets, per the token-naming convention). The Discord app is
# created manually (Discord Developer Portal → OAuth2); redirect URI must be
# https://kjcdddzyibwqahgiypdb.supabase.co/auth/v1/callback. Empty (default) => Discord auth
# stays OFF and the supabase module does not manage the auth config at all (apply unchanged).
variable "heistmind_discord_client_id" {
  type        = string
  default     = ""
  description = "Discord OAuth Client ID for HeistMind (secret TF_VAR_HEISTMIND_DISCORD_CLIENT_ID). Empty = Discord auth disabled."
}

variable "heistmind_discord_client_secret" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Discord OAuth Client Secret for HeistMind (secret TF_VAR_HEISTMIND_DISCORD_CLIENT_SECRET). Empty = Discord auth disabled."
}

variable "cloudflare_account_id" {
  type    = string
  default = "47f5715fc54e2280476f65d03cce71f5"
}

variable "keepalive_github_token" {
  type      = string
  sensitive = true
  default   = "" # token with issues:write for the alert sink; empty = alerts no-op
}

locals {
  heistmind_supabase_url = module.heistmind_supabase.url
}

# One Supabase project (schema-per-env), imported + kept declarative + recreatable.
module "heistmind_supabase" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/supabase?ref=v0.6.0"

  name              = "heistmind"
  project_name      = "heistmind-db" # exact existing name (replace-forcing — must match)
  organization_id   = "kvscndbazripnyavwjkq"
  database_password = var.heistmind_supabase_database_password
  region            = "us-east-1"

  # Discord OAuth — enabled only when BOTH scoped creds are present, so apply is a no-op until
  # the Discord app exists + its secrets are set (then `plan` shows the /config/auth change).
  discord_auth_enabled  = var.heistmind_discord_client_id != "" && var.heistmind_discord_client_secret != ""
  discord_client_id     = var.heistmind_discord_client_id
  discord_client_secret = var.heistmind_discord_client_secret
  # Canonical brand domain is www.heistmind.com — the served / Vercel-primary domain (the apex
  # heistmind.com 307-redirects to it). Both are custom domains on the same Vercel project, attached
  # outside this terraform. auth_site_url is the post-auth fallback + email base.
  auth_site_url = "https://www.heistmind.com"
  auth_additional_redirect_urls = [
    # Allow-list every served origin so Discord OAuth returns the user to the root they started on:
    # the app passes window.location.origin as redirectTo, and Supabase only honors allow-listed
    # URLs (else it falls back to auth_site_url). www first (primary); apex too in case a user hits
    # it before the redirect. The rtrentjones.dev entries stay so the Greenlight-managed domain +
    # beta verify keep working.
    "https://www.heistmind.com/**",
    "https://heistmind.com/**",
    "https://heistmind.rtrentjones.dev/**",
    "https://beta.heistmind.rtrentjones.dev/**",
    "http://localhost:3000/**",
  ]
}

# Expose the per-env schemas to the HOSTED PostgREST API. config.toml's `schemas` only governs
# the LOCAL stack; without this the live API rejects the app's `client.schema('development'|
# 'production')` with "Invalid schema". The API roles already have USAGE + table grants on both
# schemas (migration 00003_schema_grants). Discord auth is off, so the module manages no
# supabase_settings — this api-only resource doesn't collide.
resource "supabase_settings" "heistmind_api" {
  project_ref = module.heistmind_supabase.project_ref

  api = jsonencode({
    db_schema            = "public, graphql_public, development, production"
    db_extra_search_path = "public, extensions"
    max_rows             = 1000
  })
}

# Configure the EXISTING Vercel project (domains + env vars). Deploys ride git integration.
module "heistmind_vercel" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/vercel?ref=v0.6.0"

  project_id  = "prj_QF5mBjNr8sw0F8wckqWdfw1vCI2X"
  name        = "heistmind"
  domain      = "rtrentjones.dev"
  beta_branch = "development" # HeistMind uses main/development

  # One project shared by both envs (schema-per-env happens in the app); Supabase creds
  # flow straight from the supabase module (no manual copy — the old fragility).
  environment = {
    site_url_prod     = { key = "SITE_URL", target = ["production"], sensitive = false }
    site_url_beta     = { key = "SITE_URL", target = ["preview"], sensitive = false }
    supa_url_prod     = { key = "NEXT_PUBLIC_SUPABASE_URL", target = ["production"], sensitive = false }
    supa_anon_prod    = { key = "NEXT_PUBLIC_SUPABASE_ANON_KEY", target = ["production"], sensitive = false }
    supa_service_prod = { key = "SUPABASE_SERVICE_ROLE_KEY", target = ["production"], sensitive = true }
    supa_proj_prod    = { key = "SUPABASE_PROJECT_ID", target = ["production"], sensitive = false }
    supa_url_beta     = { key = "NEXT_PUBLIC_SUPABASE_URL", target = ["preview"], sensitive = false }
    supa_anon_beta    = { key = "NEXT_PUBLIC_SUPABASE_ANON_KEY", target = ["preview"], sensitive = false }
    supa_service_beta = { key = "SUPABASE_SERVICE_ROLE_KEY", target = ["preview"], sensitive = true }
    supa_proj_beta    = { key = "SUPABASE_PROJECT_ID", target = ["preview"], sensitive = false }
    # Per-env DB schema (schema-per-env in one project). Build-time NEXT_PUBLIC_ → a redeploy is
    # required for a change to take effect. Without these, provider.ts defaults to 'development'.
    schema_prod = { key = "NEXT_PUBLIC_HEISTMIND_SCHEMA", target = ["production"], sensitive = false }
    schema_beta = { key = "NEXT_PUBLIC_HEISTMIND_SCHEMA", target = ["preview"], sensitive = false }
  }
  environment_values = {
    site_url_prod     = "https://www.heistmind.com" # canonical served domain (beta stays on subdomain)
    site_url_beta     = "https://beta.heistmind.rtrentjones.dev"
    supa_url_prod     = local.heistmind_supabase_url
    supa_anon_prod    = module.heistmind_supabase.anon_key
    supa_service_prod = module.heistmind_supabase.service_role_key
    supa_proj_prod    = module.heistmind_supabase.project_ref
    supa_url_beta     = local.heistmind_supabase_url
    supa_anon_beta    = module.heistmind_supabase.anon_key
    supa_service_beta = module.heistmind_supabase.service_role_key
    supa_proj_beta    = module.heistmind_supabase.project_ref
    schema_prod       = "production"
    schema_beta       = "development"
  }
}

# Subdomain DNS — CNAME heistmind/beta.heistmind -> cname.vercel-dns.com.
module "heistmind_dns" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/tool?ref=v0.6.0"

  name        = "heistmind"
  domain      = "rtrentjones.dev"
  zone_id     = var.cloudflare_zone_id
  github_repo = "RTrentJones/HeistMind"
  lane        = "next"
  target      = "vercel"
  data        = "supabase"
  envs        = ["beta", "prod"]
  # HeistMind's repo is managed elsewhere; no GitHub envs here so CI stays single-repo (no PAT).
  manage_github_environments = false
}

# Keepalive Worker (deployed as code) — pings the Supabase project on a cron + alerts, and now
# AUTO-HEALS oci targets: on an outage it fires repository_dispatch(remediate-<tool>) so the
# wrapper's greenlight-remediate-<tool>.yml re-applies + redeploys + verifies (the no-PAYG
# recover-on-alert strategy, automated). The module ships its own bundled worker.js.
module "keepalive" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/keepalive?ref=v0.6.0"

  account_id        = var.cloudflare_account_id
  alert_github_repo = "RTrentJones/RTrentJones.dev"
  # Self-heal: dispatch remediate-<tool> here (this wrapper owns the infra + deploy). The token
  # needs contents:write (dispatch) in addition to issues:write (alerts).
  dispatch_github_repo = "RTrentJones/RTrentJones.dev"
  github_token         = var.keepalive_github_token
  targets_json = jsonencode([
    {
      name    = "heistmind"
      env     = "prod"
      url     = local.heistmind_supabase_url
      anonKey = module.heistmind_supabase.anon_key
    },
    {
      # OCI health-check (kind:"oci" → HTTP probe, no DB query). remediate:true → a failed probe
      # auto-fires greenlight-remediate-bamcp.yml (re-apply the A1 box if idle-reclaimed, redeploy,
      # verify). No PAYG: the instance is recovered on alert, not kept warm.
      name      = "bamcp"
      env       = "prod"
      kind      = "oci"
      remediate = true
      url       = "https://bamcp.rtrentjones.dev"
      probePath = "/mcp" # 401 (auth-gated) is reachable; proves tunnel + container are serving
    }
  ])
}

# --- Ship-gate: gate the HeistMind PROD deploy on its own CI -------------------------------------
# Vercel deploys `main` regardless of CI, so a broken commit could reach prod. Branch protection
# requires the `Validate & Build` check on `main` — prod (Vercel `main`) only ever holds CI-green
# commits. No required-PR, so the develop→main fast-forward still works (the target commit already
# carries the passing check). This manages the EXTERNAL RTrentJones/HeistMind repo, so it needs an
# admin token distinct from the wrapper's Actions GITHUB_TOKEN (aliased provider below).
variable "heistmind_github_admin_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = "GitHub PAT with administration:write on RTrentJones/HeistMind — manages the prod ship-gate (branch protection). Empty = ship-gate not managed (so apply works before the token is wired)."
}

provider "github" {
  alias = "heistmind_admin"
  owner = "RTrentJones"
  token = var.heistmind_github_admin_token
}

resource "github_branch_protection" "heistmind_main" {
  # Skip until the admin token is provided, so the rest of the apply isn't blocked.
  count    = var.heistmind_github_admin_token != "" ? 1 : 0
  provider = github.heistmind_admin

  repository_id  = "HeistMind"
  pattern        = "main"
  enforce_admins = true # a real gate: even an admin push to main must carry a green check

  required_status_checks {
    strict   = true
    contexts = ["Validate & Build"] # the ci.yml job's check-run name
  }
}

output "heistmind_prod_url" {
  value = module.heistmind_vercel.prod_url
}
output "heistmind_beta_url" {
  value = module.heistmind_vercel.beta_url
}
