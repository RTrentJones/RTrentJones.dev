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
  # backend "s3" {}  # Cloudflare R2 — configured at apply time (state isolation, versioning).
}

provider "cloudflare" {}
provider "github" {
  owner = "RTrentJones"
}

variable "cloudflare_zone_id" {
  type = string
}

# The blog (apex domain). Requires the framework to be tagged v0.1.0 (the module ref).
module "blog" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/tool?ref=v0.2.2"

  name        = "" # apex
  domain      = "rtrentjones.dev"
  zone_id     = var.cloudflare_zone_id
  github_repo = "RTrentJones/RTrentJones.dev"
  lane        = "astro"
  target      = "workers"
  data        = "none"
  envs        = ["beta", "prod"]
}

# Repo-level setup: the develop (beta) branch + branch protection on main/develop.
module "repo" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/repo?ref=v0.2.2"

  repository      = "RTrentJones.dev"
  required_checks = ["ci"]
}

output "blog_prod_url" {
  value = module.blog.prod_url
}
