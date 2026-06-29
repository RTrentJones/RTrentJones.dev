# Wrapper infra: instantiate Greenlight's published `module "tool"` (git-sourced by ref)
# once per tool. `greenlight add` appends a block. Real apply needs Cloudflare/GitHub
# creds + the R2 backend (see the framework infra/README.md safety rails) — gated.

terraform {
  required_version = ">= 1.7"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
    # HeistMind (see heistmind.tf). Configured from this wrapper; app code stays in its repo.
    vercel = {
      source  = "vercel/vercel"
      version = "~> 3.0"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
    # BAMCP (see bamcp.tf) — OCI Container Instance on the Always-Free A1 tier.
    # Bounded major (like the other providers): a fresh `init` without the lockfile can't jump to a
    # breaking 9.x. ~> 8.0 → >= 8.0, < 9.0 — matches the locked 8.19.0, so it's a no-op for the apply.
    oci = {
      source  = "oracle/oci"
      version = "~> 8.0"
    }
    # tracer (see tracer.tf) — serverless Postgres, a branch per env.
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.13"
    }
  }
  # Remote state on HCP Terraform (free tier, no credit card). Execution mode is "local":
  # HCP stores state + does locking; terraform runs here / in CI with our own creds. See
  # the Greenlight framework docs/terraform-state-r2.md.
  cloud {
    organization = "Greenlight-rtj"
    workspaces { name = "rtrentjones-dev" }
  }
}

provider "cloudflare" {}
provider "github" {
  owner = "RTrentJones"
}

# OCI provider for BAMCP (API-key request signing). Values come from TF_VAR_oci_* (the OCI
# creds gathered by `greenlight secrets gather`, synced as GitHub Actions secrets). Stay on the
# free tier — if the Always-Free A1 instance is ever idle-reclaimed, keepalive alerts and a
# re-apply/redeploy restores it (no PAYG; docs/oci-payg-runbook.md).
provider "oci" {
  # trimspace guards against a trailing newline/space pasted into a secret (a malformed region
  # makes the identity endpoint hostname fail to resolve — "no such host" — at plan time).
  tenancy_ocid = trimspace(var.oci_tenancy_ocid)
  user_ocid    = trimspace(var.oci_user_ocid)
  fingerprint  = trimspace(var.oci_fingerprint)
  private_key  = var.oci_private_key
  region       = trimspace(var.oci_region)
}

# Neon provider for tracer (data: neon). Configured from the NEON_API_KEY env var — the provider's
# native default (same way supabase reads SUPABASE_ACCESS_TOKEN), so no TF variable/plumbing needed.
provider "neon" {}

variable "cloudflare_zone_id" {
  type = string
}

# OCI provider auth (TF_VAR_oci_*). The VCN/subnet/AD are IaC (oci-network module + AD data
# source in bamcp.tf), so the only manual OCI inputs are these auth values.
variable "oci_tenancy_ocid" { type = string }
variable "oci_user_ocid" { type = string }
variable "oci_fingerprint" { type = string }
variable "oci_private_key" {
  type      = string
  sensitive = true
}
variable "oci_region" { type = string }
variable "oci_compartment_id" {
  type    = string
  default = "" # blank → tenancy (root) compartment, via local.oci_compartment_id
}

# tracer (next/vercel/neon) runtime secrets, wired into the Vercel env by tracer.tf. All optional
# (default "") so an unset key just disables that capability at runtime (fail-soft): no ingest token →
# /api/ingest + /api/run fail closed (503); no provider key → that vendor is skipped by /api/run.
variable "tracer_ingest_token" {
  type      = string
  sensitive = true
  default   = "" # bearer for POST /api/ingest + /api/run (TF_VAR_TRACER_INGEST_TOKEN)
}
variable "tracer_anthropic_api_key" {
  type      = string
  sensitive = true
  default   = "" # Anthropic provider for /api/run (TF_VAR_TRACER_ANTHROPIC_API_KEY)
}
variable "tracer_gemini_api_key" {
  type      = string
  sensitive = true
  default   = "" # Google AI Studio key — free tier (TF_VAR_TRACER_GEMINI_API_KEY)
}
variable "tracer_xai_api_key" {
  type      = string
  sensitive = true
  default   = "" # xAI / Grok provider for /api/run (TF_VAR_TRACER_XAI_API_KEY)
}

locals {
  # Compartment for all OCI tools — blank var falls back to the tenancy (root) compartment.
  oci_compartment_id = var.oci_compartment_id != "" ? var.oci_compartment_id : var.oci_tenancy_ocid
}

# NOTE: the blog (apex rtrentjones.dev) is deployed + DNS-managed by wrangler
# (Workers custom_domain), NOT Terraform — a TF cloudflare_dns_record for the apex would
# collide with wrangler's. So this wrapper's Terraform manages only HeistMind (heistmind.tf).
# If the blog ever needs declarative infra, re-add module "tool"/"repo" and import the
# existing records first.
