---
name: deploy-verify-promote
version: "2"
description: The one model for delivering a feature to ANY Greenlight tool — local-gate (preview) → add it to the verify loop → ship (one command: build → deploy → SHA-gated verify → rollback on failure) → promote pinned to the verified sha. Same shape for blog (workers), web apps (vercel), and MCP servers (oci); only the matrix cells vary. Use when changing a Greenlight tool or the blog and you want it shipped with objective confidence, or when asked to deploy/verify/promote/ship.
---

# deploy-verify-promote — one loop for every tool

The execution discipline for delivering a feature to **any** Greenlight tool. The verify harness,
`ship`, and the promote guard are the **same code CI runs**, so passing locally means passing in
CI. Since v2, most of this discipline is **mechanism, not instruction**: `ship` composes
deploy→verify→rollback in one command, verify asserts the deployed **sha** (not just URL health),
and promote refuses a commit the beta gate didn't verify. Follow the steps; the gates catch the
rest.

**One shape, every tool** — only the matrix cells differ (never the steps):

```
branch → change → LOCAL GATE (greenlight preview) → ADD IT TO THE VERIFY LOOP (the tool's
  verify.config) → PUSH (CI gates on the tool's own tests, then SHIPS) → PROMOTE (web tools,
  pinned to the verified sha)
```

## Input
- `<name>` — a manifest entry: `blog`, or a tool from `greenlight.config.ts`.

## The matrix (what varies by lane×target — look up your tool, then follow the one procedure)

| lane×target | local gate (`preview`) | ship trigger | beta? / promote? | verify mode | verify config lives | code repo |
|---|---|---|---|---|---|---|
| astro/workers (blog) | build + `pnpm preview` | push `develop`/`main` → CI `ship` | **yes / yes** | api(+playwright) | `<dir>/verify.config.ts` | same repo |
| next/vercel (web app) | `preview` descriptor / build | git push (Vercel git-integration) | **yes (preview) / yes** | api/agent-web/test | tool repo `verify/<name>.config.ts` | cross-repo (submodule) |
| mcp/oci (MCP server) | `preview` descriptor (docker `/mcp`) | push → build → dispatch → wrapper `ship` | **no / no** (direct-to-prod) | mcp(+eval) | wrapper `verify/<name>.config.ts` | cross-repo (submodule) |
| mcp/workers (dev) | `pnpm start` `/mcp` | push → CI `ship` | yes / yes | mcp | `<dir>/verify.config.ts` | same repo |

Two axes cause all the variation:
- **Standing beta + promote** (web: verify beta, then `promote --commit <verified-sha>` — the FF
  refuses if develop moved after verification) vs **direct-to-prod, verify-gated** (oci: no beta on
  the free tier → the **local gate + the ship-gate are your pre-prod safety**; `ship` restarts prod
  and verifies the new image is actually serving).
- **Same-repo** vs **cross-repo adopted** (the tool's code is a `tools/<name>` submodule; its infra
  + verify config live in the **wrapper**; you edit both and **bump the submodule pointer**).

## Procedure (identical for every tool)

1. **Branch** in the tool's code repo — `git checkout -b <type>/<slug>` (`feat/new-tool`, `fix/auth`).
2. **Make the change** (+ the tool's own tests — they become the ship-gate in step 5).
3. **LOCAL GATE** — `pnpm greenlight preview <name>`: spins the tool up locally (matching its prod
   contract) and runs the verify harness against it. Green here = your pre-prod signal (essential
   for direct-to-prod oci). A passing preview writes a local receipt for HEAD (`doctor` nudges you
   if it's missing) and emits a `preview` stage event, so gate compliance is measured, not assumed.
   Iterating? `--no-build` reuses the existing build.
4. **ADD IT TO THE VERIFY LOOP** — edit the tool's `verify.config.ts` (location per the matrix) so
   the new capability is asserted: add the tool to `expectTools` (mcp — the exact-match drift guard
   is ON by default, so a forgotten entry fails the gate), a `check`/`renders`/`suite` (web), or an
   `eval` case (quality). A config may export a function `(ctx) => spec(s)` to branch on
   `ctx.preview`/`ctx.env` instead of reading env vars.
5. **PUSH** — CI gates on the tool's own tests, then **ships**: `greenlight ship <name> --env …`
   is one turn of build → deploy → **SHA-gated verify** (the deployed `/__version` must match the
   commit being shipped) → **rollback on failure** (workers restore the previous version; oci/docker
   report the heal path). A broken change never stays serving.
6. **PROMOTE (web tools)** — dispatch the promote workflow: it captures the verified sha, verifies
   beta as that sha, fast-forwards `develop → main` **pinned to it** (`promote --commit`), checks
   the promoted commit out, and ships prod with `--expect-sha`. Never force-push.
7. **Watch** — `pnpm greenlight status <name>` shows the run chain; stage events (stderr JSON /
   `--events` / the ingest POST) carry per-stage durations and outcomes.

## Rules
- `verify`/`ship` exit non-zero if any check fails; the report lists each. **Never promote/ship a
  tool whose verify is failing.**
- **Always run the local gate (step 3) before pushing a direct-to-prod (oci) tool** — there is no
  beta to catch a bad image; the deploy restarts prod.
- Cross-repo: commit the tool change in its submodule AND bump the submodule pointer in the wrapper;
  the verify config + infra are the **wrapper's** to edit.
- Connect URL for MCP tools is the tool URL + `/mcp`; `verify`/`ship` handle this by lane.
- `greenlight doctor` flags drift from this model (missing verify spec, no local preview gate,
  version-ref drift, a HEAD with no preview receipt).

## Cross-repo note
In adopted/standalone repos (BAMCP, ejected tools) this skill is delivered by the **Greenlight
Claude Code plugin** and the mechanics by the `@rtrentjones/greenlight*` npm deps; the per-repo
parameters come from that repo's (or the wrapper's) `greenlight.config.ts`.
