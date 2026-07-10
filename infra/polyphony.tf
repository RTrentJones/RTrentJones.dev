# polyphony — mcp/oci (a FastAPI book-writing platform; the mcp lane only gates the oci target).
# Review, then commit + push: the wrapper's infra.yml (HCP-backed) runs `terraform apply`.
# Assumes infra/main.tf declares: oci + neon provider(s)
# and var.cloudflare_zone_id, var.cloudflare_account_id, local.oci_compartment_id.
# External tool: app code + image build live in RTrentJones/Polyphony; this manages only its infra.

# OCI Container Instance (Always-Free Ampere A1) running the tool's GHCR image + a cloudflared
# sidecar; the tunnel routes polyphony.rtrentjones.dev → the container at localhost:8000.
# NOTE the free-tier cap: bamcp (1 OCPU/6GB) + polyphony (1 OCPU/6GB) = the full 2-OCPU/12-GB
# Always-Free A1 allowance. A third instance (or a beta) needs PAYG — see docs/oci-payg-runbook.md.
module "polyphony_tunnel" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/tunnel?ref=v0.8.0"

  account_id = var.cloudflare_account_id
  name       = "polyphony-tunnel"
  ingress = [
    { hostname = "polyphony.rtrentjones.dev", service = "http://localhost:8000" },
  ]
}

module "polyphony_network" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/oci-network?ref=v0.8.0"

  name           = "polyphony"
  compartment_id = local.oci_compartment_id
}

# Neon Postgres — instantiated directly (the manifest's data field must be 'none' for the mcp lane;
# the matrix constrains the manifest, not this file). Scale-to-zero + auto-resume → no keepalive
# needed for the DB. Protected by infra.yml's plan-guard (blocks neon_project|neon_branch destroys).
module "polyphony_neon" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/neon?ref=v0.8.0"

  name   = "polyphony"
  region = "aws-us-east-1"
  envs   = ["prod"] # oci is direct-to-prod; a beta would need a second instance anyway (A1 cap)
}

module "polyphony_instance" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/oci-container-instance?ref=v0.8.0"

  name           = "polyphony"
  compartment_id = local.oci_compartment_id
  subnet_id      = module.polyphony_network.subnet_id
  image_url      = var.polyphony_image
  tunnel_token   = module.polyphony_tunnel.token

  # Polyphony runtime env — the container listens on 8000 (the tunnel routes there). The app runs
  # `alembic upgrade head` before serving, against Neon's DIRECT (non-pooled) endpoint: a
  # long-lived container with a small SQLAlchemy pool doesn't want PgBouncer in the way (asyncpg
  # prepared statements), and Neon's ~100-connection free allowance dwarfs the pool size.
  environment = {
    ENVIRONMENT  = "production"
    PORT         = "8000"
    # Vector search lives IN this database via pgvector (the app's Alembic
    # baseline creates the extension + voice_chunks table) — no separate store.
    DATABASE_URL    = module.polyphony_neon.direct_url["prod"]
    LLM_PROVIDER    = "gemini"
    GEMINI_API_KEY  = var.polyphony_gemini_api_key
    SECRET_KEY      = var.polyphony_secret_key
    ALLOWED_ORIGINS = "https://polyphony.rtrentjones.dev"
    # First-boot admin (created only when the users table is empty); registration is invite-gated,
    # so this account mints the first invite codes.
    ADMIN_EMAIL    = "rtrentjones@gmail.com"
    ADMIN_PASSWORD = var.polyphony_admin_password
  }
}

variable "polyphony_image" {
  type    = string
  default = "ghcr.io/rtrentjones/polyphony:prod"
  # Mutable :prod tag is INTENTIONAL (same rationale as bamcp): the OCI self-heal/restart re-pulls
  # the latest :prod image — that IS the redeploy. A digest pin would break the re-pull.
  description = "GHCR image for polyphony (built + pushed by RTrentJones/Polyphony's own CI). Mutable :prod tag is intentional — the OCI restart re-pulls latest."
}

variable "polyphony_gemini_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Gemini API key for the LLM backend (sourced from the SHARED account GEMINI_API_KEY secret in infra.yml, tracer-style)."
}

variable "polyphony_secret_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "JWT signing key (>= 32 chars). App refuses to boot without it."
}

variable "polyphony_admin_password" {
  type        = string
  default     = ""
  sensitive   = true
  description = "First-boot admin password (admin user created only when the users table is empty)."
}

# Subdomain DNS — CNAME polyphony → the tunnel.
module "polyphony_dns" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/tool?ref=v0.8.0"

  name         = "polyphony"
  domain       = "rtrentjones.dev"
  zone_id      = var.cloudflare_zone_id
  github_repo  = "RTrentJones/Polyphony"
  lane         = "mcp"
  target       = "oci"
  data         = "none"
  envs         = ["prod"] # oci is direct-to-prod (no beta instance on the free A1 cap)
  cname_target = module.polyphony_tunnel.cname_target
  # External repo managed elsewhere; no GitHub envs here so CI stays single-repo.
  manage_github_environments = false
}

output "polyphony_prod_url" { value = module.polyphony_dns.prod_url }
output "polyphony_tunnel_token" {
  value     = module.polyphony_tunnel.token
  sensitive = true
}
output "polyphony_container_instance_id" {
  value       = module.polyphony_instance.container_instance_id
  description = "Set as OCI_CONTAINER_INSTANCE_OCID so `greenlight deploy polyphony` restarts it."
}
