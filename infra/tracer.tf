# tracer — next/vercel/neon, emitted by `greenlight add`.
# Review, then commit + push: the wrapper's infra.yml (HCP-backed) runs `terraform apply`.
# Assumes infra/main.tf declares: vercel + neon provider(s)
# and the variables var.cloudflare_zone_id.

# One Neon project, a branch per env (prod = the project's default branch; beta = a child
# branch — copy-on-write, instant). Compute scales to zero and auto-resumes on the next connection,
# so a Neon tool needs NO keepalive (the reason Neon is the default Postgres). NEON_API_KEY configures
# the provider in main.tf; the connection strings are module OUTPUTS — no per-tool secret to gather.
module "tracer_neon" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/neon?ref=v0.5.1"

  name   = "tracer"
  region = "aws-us-east-1" # Neon region id, e.g. aws-us-east-1 / aws-us-west-2
  envs   = ["prod", "beta"]
}

# Configure the EXISTING Vercel project (domains + env vars). Deploys ride git integration.
module "tracer_vercel" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/vercel?ref=v0.5.1"

  project_id  = "prj_ev1nRFj5gIzFHwVOigsXnLJzsm4d" # non-secret id; committed like heistmind's (no HCP var)
  name        = "tracer"
  domain      = "rtrentjones.dev"
  beta_branch = "develop"

  environment = {
    site_url_prod  = { key = "SITE_URL", target = ["production"], sensitive = false }
    site_url_beta  = { key = "SITE_URL", target = ["preview"], sensitive = false }
    db_url_prod    = { key = "DATABASE_URL", target = ["production"], sensitive = true }
    db_direct_prod = { key = "DIRECT_URL", target = ["production"], sensitive = true }
    db_url_beta    = { key = "DATABASE_URL", target = ["preview"], sensitive = true }
    db_direct_beta = { key = "DIRECT_URL", target = ["preview"], sensitive = true }
    # Pass-two runtime secrets — same value on prod + preview. Ingest token guards POST /api/ingest +
    # /api/run; the provider keys enable /api/run vendors (each optional → fail-soft when "").
    ingest_token_prod  = { key = "TRACER_INGEST_TOKEN", target = ["production"], sensitive = true }
    ingest_token_beta  = { key = "TRACER_INGEST_TOKEN", target = ["preview"], sensitive = true }
    anthropic_key_prod = { key = "ANTHROPIC_API_KEY", target = ["production"], sensitive = true }
    anthropic_key_beta = { key = "ANTHROPIC_API_KEY", target = ["preview"], sensitive = true }
    gemini_key_prod    = { key = "GEMINI_API_KEY", target = ["production"], sensitive = true }
    gemini_key_beta    = { key = "GEMINI_API_KEY", target = ["preview"], sensitive = true }
    xai_key_prod       = { key = "XAI_API_KEY", target = ["production"], sensitive = true }
    xai_key_beta       = { key = "XAI_API_KEY", target = ["preview"], sensitive = true }
  }
  # Pooled (DATABASE_URL) for the serverless app; direct (DIRECT_URL) for migrations. Prod hits the
  # project's default branch; beta hits the "beta" branch — separate data, instant copy-on-write.
  environment_values = {
    site_url_prod  = "https://tracer.rtrentjones.dev"
    site_url_beta  = "https://beta.tracer.rtrentjones.dev"
    db_url_prod    = module.tracer_neon.database_url["prod"]
    db_direct_prod = module.tracer_neon.direct_url["prod"]
    db_url_beta    = module.tracer_neon.database_url["beta"]
    db_direct_beta = module.tracer_neon.direct_url["beta"]
    ingest_token_prod  = var.tracer_ingest_token
    ingest_token_beta  = var.tracer_ingest_token
    anthropic_key_prod = var.tracer_anthropic_api_key
    anthropic_key_beta = var.tracer_anthropic_api_key
    gemini_key_prod    = var.tracer_gemini_api_key
    gemini_key_beta    = var.tracer_gemini_api_key
    xai_key_prod       = var.tracer_xai_api_key
    xai_key_beta       = var.tracer_xai_api_key
  }
}

# Subdomain DNS — CNAME tracer/beta.tracer → cname.vercel-dns.com.
module "tracer_dns" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/tool?ref=v0.5.1"

  name        = "tracer"
  domain      = "rtrentjones.dev"
  zone_id     = var.cloudflare_zone_id
  github_repo = "RTrentJones/RTrentJones.dev"
  lane        = "next"
  target      = "vercel"
  data        = "neon"
  envs        = ["prod", "beta"]
  # Monorepo tool: Vercel's git-integration (root dir tools/tracer) owns the deploy, so there's no
  # GitHub-Actions deploy for tracer → don't create GitHub environments in the wrapper repo.
  manage_github_environments = false
}

output "tracer_prod_url" { value = module.tracer_vercel.prod_url }
output "tracer_beta_url" { value = module.tracer_vercel.beta_url }
