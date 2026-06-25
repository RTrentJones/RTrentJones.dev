# HeistMind apply — tokens & values for this repo

**How to get each token (generic):** see the framework guide →
[Greenlight `docs/provider-tokens.md`](https://github.com/RTrentJones/greenlight/blob/main/docs/provider-tokens.md)
(Cloudflare needs **Workers Scripts: Edit** + **Zone DNS: Edit**; Supabase = Management API
token; Vercel = team-scoped token).

Secrets live **only as GitHub Actions secrets** — Greenlight keeps no local secret file. Set/rotate
them with `gh secret set <NAME>` (value on stdin) or `greenlight secrets gather heistmind` (hidden
input, pushed straight to GitHub, never to disk). CI (`.github/workflows/infra.yml`) reads them at
`terraform apply`.

The non-secret IDs already wired into this repo's infra:

| thing | value |
|---|---|
| Cloudflare account | `47f5715fc54e2280476f65d03cce71f5` |
| Cloudflare zone (`rtrentjones.dev`) | `9c07f36cb8f4f19f577193de79500896` |
| Supabase org (RTJ) | `kvscndbazripnyavwjkq` |
| Supabase project (`heistmind-db`) | `kjcdddzyibwqahgiypdb` |
| Vercel team | `team_43JnQTGSMAIlMIVyBuOjiS8W` |
| Vercel project (`heist-mind-web`) | `prj_QF5mBjNr8sw0F8wckqWdfw1vCI2X` |

## Secrets to set (GitHub Actions secrets on this repo)

```sh
CLOUDFLARE_API_TOKEN              # Workers Scripts:Edit + Zone DNS:Edit (+ Tunnel:Edit for bamcp)
SUPABASE_ACCESS_TOKEN
VERCEL_API_TOKEN
TF_VAR_cloudflare_zone_id=9c07f36cb8f4f19f577193de79500896   # non-secret id, set as a TF var
TF_VAR_supabase_database_password=import-placeholder         # ignored on import (project exists)
TF_VAR_keepalive_github_token                                # optional: PAT, Issues:write on RTrentJones.dev
```

Set each with `gh secret set <NAME>` or `greenlight secrets gather heistmind`.

## Apply

Normal applies run in **CI** — push to `main` with changes under `infra/**` and
`.github/workflows/infra.yml` runs `terraform plan` → `apply` with the GitHub Actions secrets above.

The initial Supabase **import** was a one-time bootstrap (the project pre-existed). If it ever needs
re-running, do it as a single shell session with the tokens exported in-process (never a committed
file) — or via a `workflow_dispatch` of `infra.yml`:

```sh
export CLOUDFLARE_API_TOKEN=… SUPABASE_ACCESS_TOKEN=… VERCEL_API_TOKEN=… \
  TF_VAR_cloudflare_zone_id=9c07f36cb8f4f19f577193de79500896 \
  TF_VAR_supabase_database_password=import-placeholder
terraform -chdir=infra init
terraform -chdir=infra import module.heistmind_supabase.supabase_project.this kjcdddzyibwqahgiypdb
terraform -chdir=infra plan       # review — nothing should destroy the DB (ignore_changes guards it)
terraform -chdir=infra apply      # vercel env+domain, DNS CNAME, keepalive worker+cron
```
