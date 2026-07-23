# bamcp — mcp/oci, emitted by `greenlight add`.
# Review, then commit + push: the wrapper's infra.yml (HCP-backed) runs `terraform apply`.
# Assumes infra/main.tf declares: oci provider(s)
# and var.cloudflare_zone_id, var.cloudflare_account_id, local.oci_compartment_id.
# External tool: app code + deploy live in RTrentJones/BAMCP; this manages only its infra here.

# OCI Container Instance (Always-Free Ampere A1) running the tool's GHCR image + a cloudflared
# sidecar; the tunnel routes bamcp.rtrentjones.dev → the container at localhost:8000. The tool's OWN
# CI builds + pushes the image (provider-agnostic); deploy = restart the instance (re-pull).
# beta would be a second instance + tunnel route — mind the free 2-OCPU / 12-GB A1 cap.
module "bamcp_tunnel" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/tunnel?ref=v0.8.0"

  account_id = var.cloudflare_account_id
  name       = "bamcp-tunnel"
  ingress = [
    { hostname = "bamcp.rtrentjones.dev", service = "http://localhost:8000" },
  ]
}

# Network is IaC too — VCN + public subnet (egress only). No hand-clicking in the OCI console.
module "bamcp_network" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/oci-network?ref=v0.8.0"

  name           = "bamcp"
  compartment_id = local.oci_compartment_id
}

module "bamcp_instance" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/oci-container-instance?ref=v0.8.0"

  name           = "bamcp"
  compartment_id = local.oci_compartment_id
  subnet_id      = module.bamcp_network.subnet_id
  image_url      = var.bamcp_image
  tunnel_token   = module.bamcp_tunnel.token
  # availability_domain is auto-picked (first AD in the compartment); set it to pin a specific AD.

  # BAMCP runtime env — the container listens on 8000 (the tunnel routes there). OAuth on in prod.
  environment = {
    BAMCP_TRANSPORT    = "streamable-http"
    BAMCP_HOST         = "0.0.0.0"
    BAMCP_PORT         = "8000"
    BAMCP_AUTH_ENABLED = "true"
    # Interactive MCP clients (claude.ai's connector) onboard via OAuth Dynamic Client
    # Registration — they POST /register to obtain a client, then run the auth-code flow. That
    # endpoint MUST be enabled or those clients can't connect (they can't pre-register). This is a
    # personal, read-only server: the practical boundary is the unpublished tunnel URL + read-only
    # tools + the remote-fetch allow-list above, NOT multi-tenant access control. The static
    # BAMCP_VERIFY_TOKEN below is a separate M2M path for the CI verify.
    BAMCP_ALLOW_DYNAMIC_REGISTRATION = "true"
    BAMCP_ISSUER_URL                 = "https://bamcp.rtrentjones.dev"
    BAMCP_RESOURCE_SERVER_URL        = "https://bamcp.rtrentjones.dev"
    BAMCP_ALLOW_REMOTE_FILES         = "true"
    # SSRF blast-radius bound: remote fetch stays ON (region-scoped streaming of public
    # datasets + remote reference FASTA is a core feature), but restricted to trusted public
    # genomics hosts instead of "any public IP". Append the user's own cloud-bucket hosts here
    # if prod needs to stream from them. Empty/unset = no allow-list (only private-IP blocking).
    BAMCP_ALLOWED_REMOTE_HOSTS = join(",", [
      "hgdownload.soe.ucsc.edu",     # UCSC reference FASTA (hg38/hg19) for CRAM decode
      "ftp.ncbi.nlm.nih.gov",        # NCBI
      "ftp-trace.ncbi.nlm.nih.gov",  # GIAB / NIST truth + sample data
      "ftp.1000genomes.ebi.ac.uk",   # 1000 Genomes (EBI)
      "1000genomes.s3.amazonaws.com" # 1000 Genomes (S3, virtual-hosted HTTPS)
    ])
    BAMCP_RATE_LIMIT = "60"
    # cloudflared tunnel sidecar is co-located → the immediate proxy is loopback. XFF is trusted
    # only from here, so an external client cannot spoof its IP to bypass per-IP rate limits.
    BAMCP_RATE_LIMIT_TRUSTED_PROXIES = "127.0.0.1,::1"
    # M2M service token for the CI verify (stateless bearer → survives restarts). The SAME secret is
    # presented by the verify step (greenlight-deploy/remediate). Empty → functional verify dormant;
    # the 401 smoke still gates. Per-tool name (BAMCP_) so it never collides with another tool.
    BAMCP_VERIFY_TOKEN = var.bamcp_verify_token
  }
}

variable "bamcp_image" {
  type    = string
  default = "ghcr.io/rtrentjones/bamcp:prod"
  # The mutable :prod tag is INTENTIONAL (not an oversight): the OCI self-heal/restart re-pulls the
  # latest :prod image, which is exactly how a redeploy/remediation picks up BAMCP's newest build. A
  # digest pin would defeat that — a restart would re-pull the same old layer — so this stays a tag.
  description = "GHCR image for bamcp (built + pushed by RTrentJones/BAMCP's own CI). Mutable :prod tag is intentional — the OCI restart re-pulls latest; a digest pin would break the self-heal re-pull."
}

variable "bamcp_verify_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "M2M service token the CI verify presents to BAMCP (accepted statelessly with read scope). Empty = functional verify dormant; the 401 smoke still gates."
}

# Subdomain DNS — CNAME bamcp/beta.bamcp → the tunnel.
module "bamcp_dns" {
  source = "git::https://github.com/RTrentJones/greenlight.git//infra/modules/tool?ref=v0.8.0"

  name         = "bamcp"
  domain       = "rtrentjones.dev"
  zone_id      = var.cloudflare_zone_id
  github_repo  = "RTrentJones/BAMCP"
  lane         = "mcp"
  target       = "oci"
  data         = "none"
  envs         = ["prod"] # oci is direct-to-prod (no beta instance on the free A1 cap)
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
