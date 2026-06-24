# RTrentJones.dev

Personal site, orchestrated by [Greenlight](https://github.com/RTrentJones/greenlight). This is a **thin consumer**: it owns the manifest + content, and pulls the harness (CLI, verify, adapters, loop) from the `@rtrentjones/greenlight*` packages.

## Layout

- `greenlight.config.ts` — the manifest (domain + tools). The one file that defines this setup.
- `apps/blog/` — the blog (Astro → Cloudflare Workers).
- `infra/` — Terraform: instantiates Greenlight's `module "tool"` (git-sourced by `?ref=`) per tool.
- `.github/workflows/` — `deploy` (PR→preview, develop→beta, main→prod) + `promote` (gated FF). Creds-guarded.

## Develop

```
mise install                 # Node 24 + pnpm 10
pnpm install                 # the published @rtrentjones/greenlight + blog deps
pnpm greenlight config       # validate the manifest
pnpm greenlight doctor       # consistency checks
pnpm greenlight preview blog # build + serve locally + verify, one command
```

Shipping a change is the deploy-verify-promote loop — install the Greenlight Claude Code plugin (`/plugin marketplace add RTrentJones/greenlight` → `/plugin install greenlight@greenlight`) or run `pnpm greenlight agent sync` to get the skill in this repo.

## Framework consumption

`package.json` depends on the **published** `@rtrentjones/greenlight` (`^0.2.27`); Terraform pins the matching module tag (`?ref=v0.2.27`). Updates arrive via `pnpm update @rtrentjones/greenlight` (then bump the `?ref=`) — no merging framework code.

Two tools run on it: **[BAMCP](https://github.com/RTrentJones/BAMCP)** (`mcp`/`oci`, [live](https://bamcp.rtrentjones.dev/mcp)) and **[HeistMind](https://github.com/RTrentJones/HeistMind)** (`next`/`vercel`/`supabase`, [live](https://heistmind.rtrentjones.dev)), each a `tools/<name>` submodule with a green verify gate.
