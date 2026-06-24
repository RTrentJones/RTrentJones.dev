---
name: deploy-verify-promote
description: The one model for delivering a feature to ANY Greenlight tool — local-gate (preview) → add it to the verify loop → ship (gated on the tool's own tests) → verify prod. Same shape for blog (workers), web apps (vercel), and MCP servers (oci); only the matrix cells vary. Use when changing a Greenlight tool or the blog and you want it shipped with objective confidence, or when asked to deploy/verify/promote.
---

# deploy-verify-promote — one loop for every tool

The execution discipline for delivering a feature to **any** Greenlight tool. The verify harness and
promote guard are the **same code CI runs**, so passing locally means passing in CI. This is what
lets a change (or a long autonomous string of changes) ship with objective confidence, not vibes.

**One shape, every tool** — only the matrix cells differ (never the steps):

```
branch → change → LOCAL GATE (greenlight preview) → ADD IT TO THE VERIFY LOOP (the tool's
  verify.config) → SHIP (push; CI gates on the tool's own tests) → DEPLOY → VERIFY PROD
```

## Input
- `<name>` — a manifest entry: `blog`, or a tool from `greenlight.config.ts`.

## The matrix (what varies by lane×target — look up your tool, then follow the one procedure)

| lane×target | local gate (`preview`) | ship trigger | beta? / promote? | deploy | verify mode | verify config lives | code repo |
|---|---|---|---|---|---|---|---|
| astro/workers (blog) | build + `pnpm preview` | push `develop`/`main` | **yes / yes** | wrangler | api(+playwright) | `<dir>/verify.config.ts` | same repo |
| next/vercel (web app) | `preview` descriptor / build | git push (Vercel) | **yes (preview) / yes** | Vercel git-integration | api/agent-web/test | tool repo `verify/<name>.config.ts` | cross-repo (submodule) |
| mcp/oci (MCP server) | `preview` descriptor (docker `/mcp`) | push → build → dispatch | **no / no** (direct-to-prod) | restart instance | mcp(+eval) | wrapper `verify/<name>.config.ts` | cross-repo (submodule) |
| mcp/workers (dev) | `pnpm start` `/mcp` | push | yes / yes | wrangler | mcp | `<dir>/verify.config.ts` | same repo |

Two axes cause all the variation:
- **Standing beta + promote** (web: a cheap preview/beta exists → verify beta, then gated FF
  `develop→main`) vs **direct-to-prod, verify-gated** (oci: no beta on the free tier → the
  **local gate + the ship-gate are your pre-prod safety**; deploy restarts prod, then verify prod).
- **Same-repo** vs **cross-repo adopted** (the tool's code is a `tools/<name>` submodule; its infra
  + verify config live in the **wrapper**; you edit both and **bump the submodule pointer**).

## Procedure (identical for every tool)

1. **Branch** in the tool's code repo — `git checkout -b <type>/<slug>` (`feat/new-tool`, `fix/auth`).
2. **Make the change** (+ the tool's own tests — they become the ship-gate in step 4).
3. **LOCAL GATE** — `pnpm greenlight preview <name>`: spins the tool up locally (matching its prod
   contract) and runs the verify harness against it. Green here = your pre-prod signal (essential for
   direct-to-prod oci, which has no beta). `preview` sets `GREENLIGHT_PREVIEW=1` so a config can pick
   a local-appropriate spec (e.g. skip an auth-rejection a local no-auth server can't satisfy).
4. **ADD IT TO THE VERIFY LOOP** — edit the tool's `verify.config.ts` (location per the matrix) so
   the new capability is asserted: add the tool to `expectTools` (mcp; `exactTools: true` makes a
   forgotten entry fail the gate), a `check`/`renders`/`suite` (web), or an `eval` case (quality).
5. **SHIP** — push. CI **gates on the tool's own tests** before anything deploys (container build
   `needs: [test]`; vercel via `deployment_status`; workers via deploy→verify). A broken change never
   reaches prod.
6. **DEPLOY + VERIFY PROD** —
   - **web (beta+promote):** merge to `develop` → beta; `greenlight verify <name> --env beta`; then
     `greenlight promote <name>` (gated FF `develop→main` — never force-push); `verify --env prod`.
   - **oci (direct-to-prod):** the push builds → dispatches → the wrapper restarts the instance →
     `greenlight verify <name> --env prod` runs automatically as the deploy gate.
7. **Watch** — `pnpm greenlight status <name>` shows the last build/deploy/verify run across repos.

## Rules
- `verify` exits non-zero if any check fails; the report lists each. **Never promote/ship a tool
  whose verify is failing.**
- **Always run the local gate (step 3) before pushing a direct-to-prod (oci) tool** — there is no
  beta to catch a bad image; the deploy restarts prod.
- Cross-repo: commit the tool change in its submodule AND bump the submodule pointer in the wrapper;
  the verify config + infra are the **wrapper's** to edit.
- Connect URL for MCP tools is the tool URL + `/mcp`; `verify` handles this by lane.
- `greenlight doctor` flags any tool drifting from this model (no verify spec, no local preview gate).

## Cross-repo note
In adopted/standalone repos (BAMCP, ejected tools) this skill is delivered by the **Greenlight
Claude Code plugin** and the mechanics by the `@rtrentjones/greenlight*` npm deps; the per-repo
parameters come from that repo's (or the wrapper's) `greenlight.config.ts`.
