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

variable "cloudflare_zone_id" {
  type = string
}

# NOTE: the blog (apex rtrentjones.dev) is deployed + DNS-managed by wrangler
# (Workers custom_domain), NOT Terraform — a TF cloudflare_dns_record for the apex would
# collide with wrangler's. So this wrapper's Terraform manages only HeistMind (heistmind.tf).
# If the blog ever needs declarative infra, re-add module "tool"/"repo" and import the
# existing records first.
