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
pnpm install                 # framework from vendored tarballs (bootstrap), blog deps
pnpm greenlight config       # validate the manifest
pnpm greenlight doctor       # consistency checks
pnpm greenlight preview blog # build + serve locally + verify, one command
```

Shipping a change is the deploy-verify-promote loop — install the Greenlight Claude Code plugin (`/plugin marketplace add RTrentJones/greenlight` → `/plugin install greenlight@greenlight`) or run `pnpm greenlight agent sync` to get the skill in this repo.

## Framework consumption

`package.json` currently bootstraps the framework from **vendored tarballs** (`vendor/*.tgz`) because the packages aren't on npm yet. **After the first `npm publish`:** delete `vendor/`, switch the `@rtrentjones/greenlight*` deps to `^0.1.0`, and tag the framework so `infra/main.tf`'s `?ref=` resolves. Updates then arrive via `pnpm update` — no merging framework code.
