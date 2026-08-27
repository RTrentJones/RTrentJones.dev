# Day 0 results — the spike was run, and PASS-1 holds

Run 2026-08-26 on Chrome **151.0.7922.138** (Windows), `chrome://flags/#enable-webmcp-testing`
enabled, three localhost origins served by `serve.mjs`. Raw blobs are in `evidence/`.

`FINDINGS.md` is what the *docs* said. This is what the *browser* did.

## Every check passed

| ID | Verdict | Measured |
| --- | --- | --- |
| `T0` | **PASS** | `document.modelContext` present, `originAgentCluster=true` |
| `T0b` | **PASS** | both cross-origin children loaded and registered |
| `T1` | **PASS** | `getTools() -> [parent_ping]` |
| `T2` | **PASS** | parent discovered `alpha_ping`@8792 and `betaPing`@8793 |
| `T3` | **PASS** | **PASS-1.** `alpha_ping -> "ALPHA_OK"`, `betaPing -> "BETA_OK"` |
| `T4` | **PASS** | **PASS-2.** `origin=http://localhost:8792`, `window=present` |
| `T5` | **PASS** | both `search` tools survived, distinguishable by origin |
| `T6` | **PASS** | **negative control held** — `alpha_private` stayed invisible |
| `T7` | **PASS** | proxy `air__alpha_ping` registered and returned `ALPHA_OK` |
| `T8` | **PASS** | `toolchange` **did** fire on the parent for a cross-origin change |
| `T9` | **PASS** | **PASS-3.** child unregistered live; parent stopped seeing it, no reload |

Run twice — headless (`HeadlessChrome/151`) and headed (`Chrome/151`) — identical results,
so this is not a headless artifact. Both blobs are in `evidence/`.

## What this settles

- **Federation works.** One document saw and executed tools inside two independent origins
  in a single session. Section 1 of the build plan is viable as an architecture.
- **The two-sided opt-in is real, not decorative.** `T6` is the load-bearing result: a tool
  registered without `exposedTo` was invisible to the parent even though the iframe carried
  `allow="tools"`. The security story in `FINDINGS.md` ("each provider names the workbench it
  is willing to be composed into") is measured behavior, not a reading of the spec.
- **The live inspector can be event-driven.** `T8` was the open question and it fired. No polling.
- **Selection-driven registration survives** — `T9` passed, so the plan's novel idea stays in,
  subject to the Chrome 153 caveat below.
- **Provenance is free.** `T4` confirms Correction 3: delete the `postMessage` attribution
  fallback and the "unattributed state" work from the plan.

## Corrections to FINDINGS.md, now measured

1. **`navigator.modelContext` is not wrong.** The first "Confirmed" bullet says "Not
   `navigator`." In Chrome 151, `document.modelContext === navigator.modelContext` is
   **`true`** — one object, two accessors. Use `document.`, but the claim as written is false.
2. **`executeTool`'s second argument is required and must be a JSON string.** Correction 5 got
   the string part right and understated it. Measured:
   - `executeTool(tool, '{"q":"s"}')` → works
   - `executeTool(tool, {q:'o'})` → **throws** `UnknownError: Failed to parse input arguments`
   - `executeTool(tool)` → **throws** `TypeError: 2 arguments required, but only 1 present`
3. **`getTools({fromOrigins})` is additive, not exclusive.** It returned the parent's own
   `parent_ping` alongside the two children's tools. The aggregator must not assume every
   tool in that array is foreign — filter on `origin` when building the inspector rail.
4. **Tool descriptor shape**, as returned: `description, inputSchema, name, annotations,
   origin, title, window`. `title` is `""` when unset, not `undefined`.
5. **`registerTool` resolves to `undefined`.** Hold the `AbortController`, not a return value.
6. **Chrome 151 is below 153**, so Correction 4 is live for this machine: `controller.abort()`
   during a selection change also kills any in-flight call to that tool. Don't re-register
   while a call is running.
7. **WebMCP is not on by default in 151.** Controlled for: same page, same profile shape,
   flag absent → `document.modelContext` is `undefined`. The flag is doing the work.

## Still open — do not treat these as answered

- **The external-agent check is unanswered.** `T7` proves the workbench *can* proxy a foreign
  tool onto its own top-level surface. It does **not** prove an external agent (ChatGPT's
  in-app browser, or Chrome's built-in agent) then sees `air__alpha_ping`. That check is
  manual (`README.md`, "The one test that is not automated") and still decides
  **architecture A vs B**. Nothing here overrides `FINDINGS.md`'s advice that **B is the safe
  default**.
- **localhost is not the deployment.** Three ports are three origins, which is enough to
  exercise the handshake, but `exposedTo` is documented as accepting secure origins only.
  Re-run on real HTTPS subdomains before committing to the build.
- **One browser, one version.** Chrome 151 only. No cross-version or cross-browser evidence.

## Reproducing

```
node spike/serve.mjs
# then open http://localhost:8791 in Chrome 149+ with the flag on
```

For an unattended run (writes `spike/results.json`, gitignored):

```
node spike/serve.mjs
chrome --user-data-dir=<fresh> --headless=new "http://localhost:8791/?report=1"
```

The flag can be enabled without touching a real profile by writing, into a fresh
`--user-data-dir` before first launch, a `Local State` file containing:

```json
{"browser":{"enabled_labs_experiments":["enable-webmcp-testing@1"]}}
```
