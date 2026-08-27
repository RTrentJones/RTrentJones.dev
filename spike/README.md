# Day 0 — WebMCP cross-origin federation spike

Answers one question: **can a single agent see and call tools from several independent
origins embedded in one page?** Everything in the build plan depends on the answer.

Verified against the Chrome docs on 2026-08-27 (imperative API page last updated 2026-08-20).
Read `FINDINGS.md` first — the plan's assumption about how federation works was wrong, and
this harness is built to test the corrected version.

## Requirements

- **Chrome 149 or newer.** WebMCP does not exist before 149. Check `chrome://version`.
- Enable `chrome://flags/#enable-webmcp-testing` and restart.
- Every origin must send `Origin-Agent-Cluster: ?1` (the bundled server does).

Chromium 141 — what this repo's Playwright ships — does **not** have WebMCP. `document.modelContext`
is undefined. The harness detects this and reports `T0 FAIL` rather than pretending.

## Run it locally

```
node spike/serve.mjs
```

Then open <http://localhost:8791> in Chrome 149+. Results render as a table; hit
**Copy raw JSON** and paste that back into the thread.

Three localhost ports are three distinct origins, which is enough to exercise the
`exposedTo` / `fromOrigins` handshake. It is **not** enough to trust the final answer —
`exposedTo` is documented as accepting secure origins only, and `http://localhost` may be
treated differently from `https://sub.domain`. Re-run deployed before committing to the build.

## Run it deployed

Serve the three files from three real subdomains with the same headers, then:

```
https://parent.example/?a=https://childa.example&b=https://childb.example
```

The parent passes its own origin down to each child as `?parent=`, and each child puts that
in `exposedTo`. Nothing is hardcoded to localhost except the defaults.

## What each test establishes

| ID | Establishes |
| --- | --- |
| `T0` | WebMCP exists in this browser at all. If this fails, nothing below ran. |
| `T0b` | Both cross-origin children loaded and registered. |
| `T1` | The top-level document can register and see its own tools. |
| `T2` | The parent **discovers** tools from both foreign origins via `getTools({fromOrigins})`. |
| `T3` | **PASS-1a.** The parent **executes** tools inside both foreign origins. |
| `T4` | **PASS-2.** Discovered tools carry `.origin` and `.window` — provenance is built in. |
| `T5` | Two tools both named `search`, from different origins, both survive discovery. |
| `T6` | **Negative control.** A child tool with no `exposedTo` stays invisible. If this fails, origin gating is not real and the security story changes. |
| `T7` | The workbench can **proxy** a foreign tool into its own top-level surface. This is the federation bridge — see `FINDINGS.md`. |
| `T8` | The parent receives `toolchange` for a *cross-origin* change. Decides whether the live inspector can be event-driven or must poll. |
| `T9` | **PASS-3.** A child unregisters a tool live and the parent stops seeing it, no reload. |

## The one test that is not automated

`T3` proves a **page-hosted** agent can federate. It does **not** prove that an
**external** agent — ChatGPT's in-app browser, or Chrome's built-in agent — sees the
combined surface. Per the explainer those agents do *not* get cross-origin iframe tools by
default. `T7` builds the workaround; whether it actually lands in an external agent's tool
list has to be checked by hand:

1. Open the deployed parent in **ChatGPT's in-app browser**.
2. Ask: *"What tools do you have available on this page?"*
3. Record whether it lists `parent_ping` only, or also `air__alpha_ping` (the proxy).
4. Ask it to call `air__alpha_ping` and record whether `ALPHA_OK` comes back.

**That result decides the architecture.** Report it with the JSON blob.

## Branch on the result

| Outcome | Action |
| --- | --- |
| T3 passes **and** the manual external-agent check sees the proxy | Build the plan as written, with the workbench as an explicit federating broker. |
| T3 passes, external agent sees **only** top-level tools and the proxy does not work | Ship the workbench with its **own** in-page agent UI. The docs' "Page Agent demo" is exactly this. Thesis survives; the demo video shows your chat panel rather than ChatGPT's. |
| T3 passes, T9 fails | Build it, drop selection-driven *registration*, use selection-driven tool *arguments* instead. |
| T6 fails | Stop and re-read. Un-exposed tools leaking cross-origin is a spec or implementation bug worth reporting upstream — and it changes the security claims in the writeup. |
| **T2/T3 fail** | Federation is not available. Fall back to plan Section 9 (single-origin shared semantic canvas). |
