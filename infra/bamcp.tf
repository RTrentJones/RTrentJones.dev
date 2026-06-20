# bamcp — mcp/oci, emitted by `greenlight add`.
# Review, then commit + push: the wrapper's infra.yml (HCP-backed) runs `terraform apply`.
# Assumes infra/main.tf declares: oci provider(s)
# and the variables var.cloudflare_zone_id, var.cloudflare_account_id, var.oci_compartment_id, var.oci_availability_domain, var.oci_subnet_id.
# External tool: app code + deploy live in RTrentJones/BAMCP; this manages only its infra here.

# OCI Container Instance (Always-Free Ampere A1) running the tool's GHCR image + a cloudflared
# sidecar; the tunnel routes bamcp.rtrentjones.dev → the container at localhost:8000. The tool's OWN
# CI builds + pushes the image (provider-agnostic); deploy = restart the instance (re-pull).
# beta would be a second instance + tunnel route — mind the free 2-OCPU / 12-GB A1 cap.
module "bamcp_tunnel" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/tunnel?ref=v0.2.4"

  account_id = var.cloudflare_account_id
  name       = "bamcp-tunnel"
  ingress = [
    { hostname = "bamcp.rtrentjones.dev", service = "http://localhost:8000" },
  ]
}

module "bamcp_instance" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/oci-container-instance?ref=v0.2.4"

  name                = "bamcp"
  compartment_id      = var.oci_compartment_id
  availability_domain = var.oci_availability_domain
  subnet_id           = var.oci_subnet_id
  image_url           = var.bamcp_image
  tunnel_token        = module.bamcp_tunnel.token

  # BAMCP runtime env — the container listens on 8000 (the tunnel routes there). OAuth on in prod.
  environment = {
    BAMCP_TRANSPORT           = "streamable-http"
    BAMCP_HOST                = "0.0.0.0"
    BAMCP_PORT                = "8000"
    BAMCP_AUTH_ENABLED        = "true"
    BAMCP_ISSUER_URL          = "https://bamcp.rtrentjones.dev"
    BAMCP_RESOURCE_SERVER_URL = "https://bamcp.rtrentjones.dev"
    BAMCP_ALLOW_REMOTE_FILES  = "true"
    BAMCP_RATE_LIMIT          = "60"
  }
}

variable "bamcp_image" {
  type        = string
  default     = "ghcr.io/rtrentjones/bamcp:prod"
  description = "GHCR image for bamcp (built + pushed by RTrentJones/BAMCP's own CI)."
}

# Subdomain DNS — CNAME bamcp/beta.bamcp → the tunnel.
module "bamcp_dns" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/tool?ref=v0.2.4"

  name         = "bamcp"
  domain       = "rtrentjones.dev"
  zone_id      = var.cloudflare_zone_id
  github_repo  = "RTrentJones/BAMCP"
  lane         = "mcp"
  target       = "oci"
  data         = "none"
  envs         = ["beta", "prod"]
  cname_target = module.bamcp_tunnel.cname_target
  # External repo managed elsewhere; no GitHub envs here so CI stays single-repo.
  manage_github_environments = false
}

output "bamcp_prod_url" { value = module.bamcp_dns.prod_url }
output "bamcp_tunnel_token" {
  value     = module.bamcp_tunnel.token
  sensitive = true
}
output "bamcp_container_instance_id" {
  value       = module.bamcp_instance.container_instance_id
  description = "Set as OCI_CONTAINER_INSTANCE_OCID so `greenlight deploy bamcp` restarts it."
}
