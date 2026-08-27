# Day 0 findings — where the build plan is wrong

Sources, all read 2026-08-27:
[imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) (updated 2026-08-20),
[tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools),
[hub](https://developer.chrome.com/docs/ai/webmcp),
[explainer](https://github.com/webmachinelearning/webmcp).

Per standing instruction 2, the docs win and the disagreements are flagged here.

## Confirmed — the plan got these right

- `document.modelContext.registerTool(descriptor, options)`. Not `navigator`.
- Descriptor: `{ name, description, inputSchema, execute, annotations }`.
  `execute` receives `(args, { signal })`.
- Unregistration is `AbortSignal`-based: pass `{ signal }` at registration, call `controller.abort()`.
- `tools` Permissions Policy defaults to `self`; cross-origin iframes need `allow="tools"`.
- `Origin-Agent-Cluster: ?1` is required — WebMCP is off in non-origin-isolated documents.
- Chrome 149 origin trial; `chrome://flags/#enable-webmcp-testing` for local dev.

## Correction 1 — federation is not automatic (this is the big one)

The plan's Section 1 asserts that an embedding page with `allow="tools"` "puts several
independent origins into one tool-discovery scope" and that "a single agent sees their
combined tool surface."

**It does not, not by itself.** `allow="tools"` only lets the child *register* tools at all.
Discovery is separately gated, on both sides:

> "Tools are unavailable to cross-origin documents by default."
>
> "Even if a tool is exposed to your origin, you must still explicitly request it from the
> hosting origin using the `fromOrigins` option in `getTools()`."

So three things must all be true:

1. Parent sets `allow="tools"` on the iframe.
2. **Child** registers with `exposedTo: ['https://workbench.origin']`.
3. **Parent** calls `getTools({ fromOrigins: ['https://child.origin'] })`.

Miss any one and the tool is invisible. The harness's `T6` is the negative control that
proves gate 2 is real.

## Correction 2 — an external agent probably sees none of it

Worse for the plan as written. The explainer's default-exposure rule:

> "By default, tools registered by a document are only exposed to itself, same-origin
> documents in the same tree, and built-in browser agents."

and the open design question:

> "The running idea is that by default in the top-level document, a missing `exposedTo`
> array would expose tools to the built-in agent, and **in iframes, a missing `exposedTo`
> array would not expose tools to the built-in agent**."

Read plainly: ChatGPT's in-app browser, attached to the workbench page, gets the
**workbench's own** tools and not the four panes'. `getTools({fromOrigins})` is an API for
*the page*, not a channel an external agent rides.

Note the hedge — "the running idea" is an unsettled design question, not shipped behavior.
This is exactly why it must be measured, and it is the one test in the harness that cannot
be automated (README, "The one test that is not automated").

### The bridge

The docs point at the pattern themselves:

> "See the WebMCP Page Agent demo for an example of how to retrieve tools from an iframe
> and execute them within a web-based chat interface."

Two viable architectures, and the manual check decides which:

- **A — broker.** The workbench discovers child tools, then **re-registers each as its own
  top-level tool** under an origin-namespaced name (`air__rebook_segment`). Top-level tools
  *are* exposed to a built-in agent. External agent works; every call routes through the
  workbench, which is precisely where the call log, call graph and provenance UI want to
  sit. `T7` tests this mechanism.
- **B — page agent.** The workbench ships its own chat panel calling `getTools`/`executeTool`
  directly. Guaranteed to work (it's the documented demo), and no dependency on unsettled
  built-in-agent behavior — but the video shows your chat UI rather than ChatGPT driving it.

Build A if the manual check passes, B if it doesn't. **B is the safe default**, and the
work is ~90% shared, so this is not a fork that costs a day.

## Correction 3 — PASS-2 is already answered

The plan treats origin attribution as an open risk with a `postMessage` fallback. Not
needed. `getTools()` returns each tool with `origin` and `window`:

```js
// { name: "addTodo", origin: "https://example.com", window: Window {...},
//   description, inputSchema, annotations, title }
```

Provenance is first-class. Delete the fallback branch and the "unattributed state" work.

## Correction 4 — Chrome 153 matters for selection-driven registration

> "As of Chrome 153, you can unregister a tool without cancelling and breaking in-flight
> executions."

Below 153, `controller.abort()` during a selection change **also kills any in-flight call**
to that tool. Since selection-driven registration is the plan's novel idea and is
explicitly not on the cut list, check the target browser's version and, on <153, avoid
re-registering while a call is running.

## Correction 5 — smaller things

- `registerTool` takes a second options argument — the plan doesn't mention it.
- `executeTool(tool, jsonInputString, { signal })` takes input as a **JSON string**, not an
  object, and returns `null` when the call triggers a navigation.
- There is a **`toolchange` event** on `document.modelContext`. This is the right driver for
  the live "agent surface" rail. Whether it fires for *cross-origin* changes is untested —
  that's `T8`. If it doesn't, the rail has to poll.
- `annotations.untrustedContentHint` exists specifically for tools returning
  user-generated or external content. The optional hostile fifth pane should use it — it
  makes that demo materially more credible.
- `webmcp-types` (npm) gives TypeScript typings; `usewebmcp` for React. The plan's
  vanilla-JS choice still stands for legibility.

## What this does to the thesis

The thesis survives, but the sentence "the browser is the integration layer" needs
qualifying, because a bystander origin cannot be federated — each pane must name the
workbench in `exposedTo` ahead of time. So the honest claim is narrower and, stated
properly, more interesting:

> Federation happens **in the browser, under a two-sided opt-in, with no shared credential**.
> Each provider names the workbench it is willing to be composed into — the way a user
> authorizes an OAuth client — except no token is ever issued, nothing is stored, and every
> call executes inside the origin that owns it, under the user's own session. The workbench
> holds no authority it wasn't handed, frame by frame.

That is a better security story than the original, and it makes the workbench do real
engineering rather than benefit from magic: namespacing the two colliding `search` tools,
reconciling the deliberately-inconsistent date formats, and rendering provenance the
browser does not surface anywhere else.

The writeup's limitations section should now say plainly: **WebMCP has no ambient
cross-origin discovery, by design.** A user whose agent has been handed a dozen tools by
four origins still has no browser-level view of who gave it what — the inspector rail is a
prototype of UI the browser itself is missing. That's the real contribution and it is worth
more than the original overclaim.

## Schedule note

The plan dates Day 0 as Aug 26; today is Aug 27, so the calendar is a day in and the spike
has not yet been run against a real browser — it cannot be run from this environment
(Chromium 141, no `document.modelContext`). Running it is ~15 minutes on a machine with
Chrome 149+. Nothing else should be built until `T3` and the manual external-agent check
have answers.
