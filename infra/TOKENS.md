# HeistMind apply — tokens & values for this repo

**How to get each token (generic):** see the framework guide →
[Greenlight `docs/provider-tokens.md`](https://github.com/RTrentJones/greenlight/blob/main/docs/provider-tokens.md)
(Cloudflare needs **Workers Scripts: Edit** + **Zone DNS: Edit**; Supabase = Management API
token; Vercel = team-scoped token).

Below are the values already wired into this repo's infra — drop the tokens into
**`.greenlight/secrets.env`** (repo root, gitignored, where `CLOUDFLARE_API_TOKEN` already is).

| thing | value |
|---|---|
| Cloudflare account | `47f5715fc54e2280476f65d03cce71f5` |
| Cloudflare zone (`rtrentjones.dev`) | `9c07f36cb8f4f19f577193de79500896` |
| Supabase org (RTJ) | `kvscndbazripnyavwjkq` |
| Supabase project (`heistmind-db`) | `kjcdddzyibwqahgiypdb` |
| Vercel team | `team_43JnQTGSMAIlMIVyBuOjiS8W` |
| Vercel project (`heist-mind-web`) | `prj_QF5mBjNr8sw0F8wckqWdfw1vCI2X` |

## `.greenlight/secrets.env` (repo root)

```sh
CLOUDFLARE_API_TOKEN=...          # Workers Scripts:Edit + Zone DNS:Edit (replaces the blog-only one)
SUPABASE_ACCESS_TOKEN=...
VERCEL_API_TOKEN=...
TF_VAR_cloudflare_zone_id=9c07f36cb8f4f19f577193de79500896
TF_VAR_supabase_database_password=import-placeholder   # ignored on import (project exists)
TF_VAR_keepalive_github_token=                          # optional: PAT, Issues:write on RTrentJones.dev
```

## Apply sequence (run from this repo root)

```sh
set -a; source .greenlight/secrets.env; set +a
(cd ../Greenlight && mise exec -- pnpm --filter @rtrentjones/greenlight-keepalive build)  # worker bundle (already built)
terraform -chdir=infra init
terraform -chdir=infra import module.heistmind_supabase.supabase_project.this kjcdddzyibwqahgiypdb
terraform -chdir=infra plan       # review — nothing should destroy the DB (ignore_changes guards it)
terraform -chdir=infra apply      # vercel env+domain, DNS CNAME, keepalive worker+cron
```
