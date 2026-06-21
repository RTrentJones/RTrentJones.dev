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
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0"
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
  tenancy_ocid = var.oci_tenancy_ocid
  user_ocid    = var.oci_user_ocid
  fingerprint  = var.oci_fingerprint
  private_key  = var.oci_private_key
  region       = var.oci_region
}

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

locals {
  # Compartment for all OCI tools — blank var falls back to the tenancy (root) compartment.
  oci_compartment_id = var.oci_compartment_id != "" ? var.oci_compartment_id : var.oci_tenancy_ocid
}

# NOTE: the blog (apex rtrentjones.dev) is deployed + DNS-managed by wrangler
# (Workers custom_domain), NOT Terraform — a TF cloudflare_dns_record for the apex would
# collide with wrangler's. So this wrapper's Terraform manages only HeistMind (heistmind.tf).
# If the blog ever needs declarative infra, re-add module "tool"/"repo" and import the
# existing records first.
