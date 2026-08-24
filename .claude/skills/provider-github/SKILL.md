---
name: provider-github
description: GitHub in a Greenlight setup — the single secret store (Actions secrets/environments), the repo/branch/protection module, the develop→main flow, OIDC-over-PAT. Use when setting tokens, wiring branch protection/environments, or debugging gh / secrets / CI auth.
---

# provider-github

GitHub is the **always-on** control plane: it holds the Actions **secrets** (provider tokens), the
**environments** (beta/prod), branch protection, and runs the deploy/promote/infra workflows. The
`develop → main` flow is standardized (PR → preview, `develop` → beta, `main` → prod; promote is a
gated fast-forward).

## Token — `GITHUB_TOKEN` (you usually don't set one)

In **CI**, Actions provides `github.token` automatically — `infra.yml` maps it to the `github`
provider; no PAT for single-repo infra. For **cross-repo** ops, use a fine-grained PAT with minimal
scopes; prefer **GitHub OIDC → cloud** over long-lived cloud tokens where supported. Full token table:
[tokens-reference.md](https://github.com/RTrentJones/greenlight/blob/main/docs/tokens-reference.md).

### Poly-repo deploy loop — the two option-B PATs

An adopted tool (submodule) and its wrapper hand off via two fine-grained PATs (`secrets gather`
pushes each to the right repo):
- **`GREENLIGHT_DISPATCH_TOKEN`** — on the **tool** repo, scoped **Contents:write** on the
  **wrapper** → the tool's build fires `repository_dispatch` so the wrapper deploys.
- **`GREENLIGHT_STATUS_TOKEN_<TOOL>`** — on the **wrapper** repo, scoped **Commit statuses:write** on
  the **tool** → the wrapper posts deploy/verify status back. **Per-tool suffix** (it lives on the
  shared wrapper alongside other tools' tokens).

Provider creds (OCI/Cloudflare/…) live **only in the wrapper**; the tool repo holds just the
dispatch PAT (its build pushes to GHCR with the built-in `github.token`). Optimal end state: a tool
repo holds **only** `GREENLIGHT_DISPATCH_TOKEN`.

## Setting secrets

GitHub Actions secrets are the **single** store (no local secret file). `greenlight secrets gather
<tool> [--repo o/r] [--env <env>]` prompts with hidden input and pipes straight to `gh secret set`
(never on disk, in argv, or logs); `greenlight secrets check [<tool>]` lists the secrets a tool's
deploy needs and flags missing ones. Run `gh auth login` first.

## Terraform module — `infra/modules/repo`

Branches + protection + required checks (+ optional environments via the `tool` module's
`manage_github_environments`). For an **external** tool (code in its own repo), set
`manage_github_environments = false` so the wrapper's CI stays single-repo (no PAT needed).

## Gotchas
- **IDs are repo variables, not secrets.** Enumerable IDs (`CLOUDFLARE_ZONE_ID`, account ids) carry
  no authority — store them as `vars.*` (referenced `${{ vars.X }}`), not secrets.
- **Protected `main`** blocks direct pushes/merges — use `gh pr create` + merge, or the gated
  `greenlight promote` fast-forward. Keep to `develop` (not `development`) for the branch.
