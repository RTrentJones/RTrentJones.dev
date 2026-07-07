# Greenlight v0.8.0 activation checklist

The framework branch (`RTrentJones/greenlight` → `claude/staff-engineer-review-anthropic-r2zd50`)
carries v0.8.0: `ship` (build → deploy → SHA-gated verify → rollback-on-failure), SHA-pinned
promotion (`promote --commit`), artifact-identity verify (`--expect-sha` + `/__version`), stage
events, function-shaped verify configs, and the `exactTools` default flip. This repo already
landed everything that works on v0.7.0 (fail-loud promote gate, heal destroy-guard, strict doctor,
pinned actions, the inert `/__version` endpoint).

**Everything below is blocked on the owner publishing v0.8.0** — merge the framework branch, then
`git tag v0.8.0 && git push origin v0.8.0` (OIDC publish via release.yml). Then, in this repo:

## 1. Bump the lockstep pair

```
pnpm update @rtrentjones/greenlight     # -> ^0.8.0
pnpm greenlight bump                    # re-pins every infra/*.tf ?ref= + the dep range
pnpm install && pnpm greenlight doctor --strict
```

Note the doctor now also checks the promote allow-list against the manifest (currently in sync:
`blog | heistmind | bamcp | tracer | muse`) and nudges locally when HEAD has no preview receipt.

## 2. deploy.yml — adopt `ship`

Replace the deploy+verify pair:

```yaml
      - name: Ship (build -> deploy -> SHA-gated verify -> rollback on failure)
        if: steps.creds.outputs.have == '1'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: pnpm exec greenlight ship blog --env "${{ steps.env.outputs.env }}"
```

`ship` defaults its expected sha to `GITHUB_SHA` — with the `/__version` endpoint already live,
this turns on artifact-identity enforcement automatically (the verify retries within the settle
budget until the deployed sha matches, and fails hard on a mismatch instead of green-lighting the
previous deployment).

## 3. promote.yml — pin the whole chain to the verified sha

After the `git fetch` step, capture the sha; then thread it through (the fail-loud creds step and
the promoted-main checkout are already in place from the v0.7.0 pass — the checkout step's
`origin/main` becomes the captured sha):

```yaml
      - name: Capture the verified sha
        id: sha
        run: echo "sha=$(git rev-parse origin/develop)" >> "$GITHUB_OUTPUT"
      ...
        run: pnpm exec greenlight verify "$NAME" --env beta --expect-sha "${{ steps.sha.outputs.sha }}"
      ...
        run: pnpm exec greenlight promote "$NAME" --perform --push --commit "${{ steps.sha.outputs.sha }}"
      ...
      - name: Check out the promoted commit
        run: |
          git checkout --detach "${{ steps.sha.outputs.sha }}"
          pnpm install --frozen-lockfile
      ...
        run: pnpm exec greenlight ship "$NAME" --env prod --expect-sha "${{ steps.sha.outputs.sha }}"
```

`promote --commit` refuses (or limits the FF to the verified commit, with a warning) when develop
moved after the beta verify — the verify→promote race is closed.

## 4. Audit `exactTools` (breaking default flip)

`verify/bamcp.config.ts` already sets `exactTools: true` explicitly, so behavior is unchanged —
but confirm `expectTools` still lists the complete live tool set. Any OTHER mcp spec with an
intentionally-partial `expectTools` now needs an explicit `exactTools: false`.

## 5. Convert env-var-reading verify configs to the function shape

Configs that read `GREENLIGHT_PREVIEW` / `GREENLIGHT_VERIFY_URL` at module-eval time
(`verify/bamcp.config.ts`, `tools/tracer/verify.config.ts` if applicable) can become:

```ts
import type { VerifyConfigContext } from '@rtrentjones/greenlight';
export default ({ preview }: VerifyConfigContext) => [
  { mode: 'mcp', expectTools: [/* … */], requireAuthRejection: !preview },
];
```

The env vars keep working (back-compat) — this is de-landmining, not a forced migration.

## 6. Wire stage events into tracer (M2)

Expose to the deploy/promote jobs:

```yaml
        env:
          GREENLIGHT_INGEST_URL: https://tracer.rtrentjones.dev/api/ingest
          TRACER_INGEST_TOKEN: ${{ secrets.TF_VAR_TRACER_INGEST_TOKEN }}
```

`ship`/`preview` then POST per-stage records (`mode` = build/deploy/verify/rollback/preview,
`git_sha`, `duration_ms`, `passed`, model=`greenlight`) — tracer's existing zod ingest accepts
them today, no schema change. The queries this unlocks: push→healthy-in-prod latency (push
timestamp → first passing prod verify for that sha), first-pass gate rate (verify events with
attempts=1), local-gate compliance (preview events joined to deploy events on git_sha), and
remediate MTTR.

## 7. Re-verify the chain end to end

- push to `develop` → deploy.yml ships beta; check the run's stage-event lines and the
  `deployed sha matches expected` check in the verify report.
- dispatch promote.yml for `blog` → confirm the FF is pinned, prod ships the promoted sha, and
  `https://rtrentjones.dev/__version` serves it.
- `pnpm greenlight status blog` for the run chain.
