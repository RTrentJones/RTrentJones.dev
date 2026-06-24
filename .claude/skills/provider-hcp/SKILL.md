---
name: provider-hcp
description: How HCP Terraform works in a Greenlight setup — the remote-state backend (free tier, no credit card), local execution mode (HCP stores state + locks; runs use local/CI creds), the cloud{} block, and TF_API_TOKEN auth. Use when setting up remote state, debugging a backend/init/locking issue, or CI apply-on-push.
---

# provider-hcp

HCP Terraform (app.terraform.io) is the **remote-state backend** for the wrapper's infra —
free tier, **no credit card**. It replaces local state so CI can `terraform apply` on push
with state locking (no two applies racing).

## Execution mode — **Local**, deliberately

The workspace is set to **Local execution mode**: HCP **stores state + does locking only**;
`terraform` runs here / in CI with **our own provider creds** (Cloudflare/Vercel/Supabase
tokens from GitHub Actions secrets). This avoids uploading every provider token to HCP.

## Token — `TF_API_TOKEN`

HCP → Account Settings → Tokens (a **user** API token). In CI it maps to the backend-auth env
var **`TF_TOKEN_app_terraform_io`** (the infra.yml does this mapping). `greenlight add`
verifies it against `/api/v2/organizations` (HTTP 200).

## The `cloud{}` block

```hcl
terraform {
  cloud {
    organization = "YOUR_ORG"
    workspaces { name = "your-domain-with-dashes" }
  }
}
```

Migrate local → HCP with a plain `terraform init` (answer `yes` to copy state). The
`-migrate-state` / `-force-copy` flags are **rejected** for the cloud backend — don't pass them.

## CI apply-on-push

`infra.yml` (on push to `main`, paths `infra/**`): map GH secrets → `TF_TOKEN_app_terraform_io`
+ the provider tokens + `TF_VAR_*`, then setup-terraform (`terraform_wrapper: false`) → init →
plan -out → apply. This is the deploy half — the CLI only edits the `.tf`; CI applies.

## Alternatives
See `docs/terraform-state.md` for the full backend chooser (HCP no-CC · OCI S3-compat ·
R2 card-required · AWS · local).
