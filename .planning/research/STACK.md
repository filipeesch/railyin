# Stack Research

**Domain:** AG-UI + CopilotKit agent-chat stack for Railyin (local-first single-process Bun + Vue 3 app)
**Researched:** 2026-08-08
**Confidence:** HIGH (versions verified against npm registry and official docs on this date)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@ag-ui/core` | **0.0.57** (pin exact) | AG-UI wire-protocol types: zod schemas for events (`TEXT_MESSAGE_*`, `TOOL_CALL_*`, `STATE_*`, `RUN_*`), `RunAgentInput`, message/content types | AG-UI is the standard the whole stack is built on — CopilotKit v2 is a client/runtime for it. Railyin's custom `StreamEvent` protocol is a home-grown subset; standardizing eliminates a bespoke protocol to maintain. CopilotKit pins 0.0.57 — match exactly. |
| `@ag-ui/client` | **0.0.57** (pin exact) | Client SDK: `AbstractAgent`, `BaseEvent`, `HttpAgent`, `RunAgentInput`, `Message` types | The `AgentRunner` contract returns `Observable<BaseEvent>` from `@ag-ui/client` — it is a direct dependency of the custom runner, not an optional nicety. |
| `@copilotkit/runtime` | **1.66.4** — import from `/v2` subpath | Server runtime: `CopilotRuntime`, `InMemoryAgentRunner`, `createCopilotRuntimeHandler` (fetch-native), `createCopilotHonoHandler` | v2 is the AG-UI-native runtime line (v1 is legacy). The custom-runner extension point is the officially documented path for custom persistence; the runtime works fully self-hosted with no cloud. `CopilotRuntime` accepts `agents: { default: <your agent> }` + `runner: <your runner>` and streams AG-UI events as SSE. |
| `@copilotkit/vue` | **1.66.4** — import from `/v2` subpath | Chat UI: `CopilotKitProvider`, `CopilotChat` (+slots incl. `#interrupt`), `CopilotChatInput`, `useInterrupt`, `useThreads` (unusable — see below), `useRenderTool`/`useDefaultRenderTool` | The only official Vue 3 SDK (community port by fynk, merged upstream June 2026, ~30k-line React port with API parity). Ships `styles.css`, markdown/KaTeX rendering via `streamdown-vue`/`katex` deps. Early-access: **pin exact version** and wrap in thin local components. |
| `rxjs` | ^7.8.2 | Observable streaming between runner and runtime | `AgentRunner.run()`/`connect()` return `Observable<BaseEvent>` — rxjs is a required peer of the runner contract. |
| *(none — no server framework)* | — | Hosting CopilotRuntime in Bun.serve | `createCopilotRuntimeHandler` is fetch-native (Bun/Deno/Workers-ready, no Node polyfills) and mounts directly in `Bun.serve`'s fetch handler. Same-origin serving means no CORS setup. **This contradicts the "hono handler" assumption in PROJECT.md — see Stack Patterns.** |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^3.25 | Runtime-validate AG-UI events and resume payloads in the bridge | AG-UI types are zod schemas; validating the engine→AG-UI mapping in the bridge catches protocol drift at dev time. Already in Railyin? (verify; `@ag-ui/core` depends on zod ^3.22 anyway) |
| `@copilotkit/runtime/v2/hono` (`@hono/hono` if chosen) | same 1.66.4 | `createCopilotHonoHandler` | Only if you prefer hono routing/CORS middleware. Not required in a single-process same-origin Bun server. |
| `bun:sqlite` (built-in) | — | Board/task state (existing) | Keep for non-chat state. Do **not** use it for chat threads — user chose JSONL files. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Playwright `page.route()` | E2E rework | All 55 existing specs hand-mock the old protocol; rework the mock layer to intercept `/api/copilotkit/*` (run/connect/stop/info + our `/api/threads`) and emit AG-UI events — the same fixture can also replay recorded JSONL |
| `npx copilotkit@latest init` | Reference scaffold only | Generates React apps; not needed for Railyin, but its generated runtime code documents current handler wiring |
| CopilotKit Inspector (`@copilotkit/web-inspector`) | Debugging | Ships as a dep of `@copilotkit/vue`; useful to verify AG-UI event flow during the bridge build |

## Installation

```bash
# Core — pin exact versions (early-access Vue SDK; AG-UI pinned by CopilotKit)
bun add @copilotkit/runtime@1.66.4 @copilotkit/vue@1.66.4
bun add @ag-ui/core@0.0.57 @ag-ui/client@0.0.57
bun add rxjs@^7.8.2

# Frontend entry: import styles once
# import "@copilotkit/vue/styles.css";

# NOT installed (see What NOT to Use):
#   @copilotkit/sqlite-runner better-sqlite3
#   @copilotkit/react-core @copilotkit/react-ui
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Custom `RailyinAgentRunner` + JSONL files | `SqliteAgentRunner` (`@copilotkit/sqlite-runner` 1.66.4) | Only if the JSONL experiment fails. It is file-backed and official, but requires the `better-sqlite3` native peer — a second SQLite path beside `bun:sqlite`, and it doesn't give you per-thread human-readable files (user preference). |
| Custom `RailyinAgentRunner` | `IntelligenceAgentRunner` (Enterprise Intelligence) | Only if you accept a cloud account or self-hosting k8s + Postgres 14 + Redis 7 + OIDC (Helm). Massive overkill for a local-first single-process tool; also it's the *only* path to working `useThreads`. |
| Own `/api/threads` endpoint (we own the JSONL files) | `useThreads` | `useThreads` **only activates when the runtime advertises Intelligence REST endpoints** (`GET /threads`, `PATCH /threads/:id`, `POST /threads/subscribe`). Self-managed runners — including SqliteAgentRunner — persist/replay history but do not provide the list/mutation/realtime contract. Our own endpoint is ~30 lines against the JSONL dir. |
| `createCopilotRuntimeHandler` mounted in `Bun.serve` | `createCopilotHonoHandler` | If the app later grows real HTTP middleware needs (auth, rate-limiting, CORS for a remote client). Today: same server, same origin, zero extra deps. |
| `useInterrupt` (composable) for decision_request | `useHumanInTheLoop` | `useHumanInTheLoop` is for LLM-initiated pauses via a client-side *tool*; `useInterrupt` is for deterministic checkpoints where code requires a human answer — exactly what `decision_request` is. `useInterrupt` renders into the `#interrupt` slot and `resolveInterrupt(payload)` resumes via `command.resume`. |
| `@copilotkit/vue` (official) | `vue-copilotkit` community wrapper (2024) | Abandoned pre-official path; the official SDK is the maintained one. |
| `@copilotkit/vue` | Keep the hand-rolled ~7k-line chat UI | Rollback if the Vue SDK proves blocking — the old stack stays intact on the main branch; old tables stay for rollback regardless. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@copilotkit/react-core` / `@copilotkit/react-ui` | React-only packages; Railyin is Vue 3. | `@copilotkit/vue/v2` (all components/composables live there). |
| `@copilotkit/sqlite-runner` + `better-sqlite3` | Native module, second SQLite stack beside `bun:sqlite`; user explicitly wants per-thread JSONL files. | Custom runner extending `InMemoryAgentRunner` with JSONL persistence (`data/threads/{threadId}.jsonl`). |
| Copilot Intelligence (`intelligence` option on `CopilotRuntime`, `CopilotKitIntelligence`, `IntelligenceAgentRunner`, `identifyUser`, `generateThreadNames`) | Requires CopilotKit Cloud or self-hosted Helm (k8s + Postgres + Redis + OIDC). Violates "no new servers, no external services, single process". `IntelligenceAgentRunner` is auto-wired and cannot be passed manually. | `InMemoryAgentRunner` subclass; own file-based persistence. |
| `useThreads` (both React and Vue versions) | Documented: "useThreads needs an Enterprise Intelligence Platform project"; self-managed runners "do not automatically provide the managed useThreads list/mutation/realtime contract". It will silently return nothing/error against our runtime. | Own thread-index endpoint (`GET /api/threads`) listing JSONL files; thread list UI reads it. |
| CopilotKit **v1** runtime/UI APIs (`@copilotkit/runtime` v1 exports, `LangGraphAgent` v1 wiring, legacy thread props) | v1 predates the AG-UI-native v2 line; PROJECT.md already targets v2. | `@copilotkit/runtime/v2`, `@copilotkit/vue/v2`. |
| Attachments on `@copilotkit/vue` (for v1 milestone) | Known open bug: Vue attachments throw `Failed to execute 'structuredClone'` (#6104). Attachments were not in scope anyway. | Defer; when revisited, use default base64 inline `onUpload` (no server storage needed — good for local-first). |
| Unpinned `@copilotkit/vue` / `^1.x` ranges | Early-access package, docs "coming soon", rapid change; version drift between `@copilotkit/runtime` and `@copilotkit/vue` breaks the proxy contract. | Pin exact `1.66.4` in `package.json`; keep runtime+vue on the same release line; isolate CopilotKit behind thin local components. |
| Custom WebSocket chat protocol / dual-layer conversation store | ~8.2k lines of bespoke streaming + store code being replaced; keep `/ws` only for board events (task.updated, code.ref, lsp). | AG-UI over SSE via the runtime connection. |
| Legacy interrupt mechanics (`on_interrupt` custom event, `forwarded_props.command.resume`) | The AG-UI spec replaced the `on_interrupt` custom event with the standard `RUN_FINISHED` `outcome: {type:"interrupt", interrupts:[{id,reason,message}]}` + `RunAgentInput.resume` entries. The legacy forms are deprecated. | Standard interrupt outcome + resume entries from the bridge; `useInterrupt` on the client. |

## Stack Patterns by Variant

**If the runtime is hosted inside `Bun.serve` (Railyin's case):**
- Use `createCopilotRuntimeHandler` — import from `@copilotkit/runtime/v2`, mount in the existing fetch handler for paths under `/api/copilotkit`, default multi-route mode (run/connect/stop/info routes).
- Because it is fetch-native (built for Bun/Deno/Workers), avoids Node polyfills, and adds **zero** new framework dependencies to a single-process server. The hono handler (`createCopilotHonoHandler` from `/v2/hono`) is the right tool only when you're already on hono. *Flag for roadmap: PROJECT.md's "hono handler" decision should be revisited — evidence points to the bare fetch handler.*
- Route table (multi-route, default): `POST /agent/:agentId/run`, `POST /agent/:agentId/connect`, `POST /agent/:agentId/stop/:threadId`, `GET /info`. Thread-mutation routes (`GET /threads`, `PATCH /threads/:threadId`, `POST /threads/subscribe`) exist only in Intelligence mode — implement our own.

**If preserving all five engine adapters through AG-UI:**
- Build `RailyinAgentRunner extends InMemoryAgentRunner`. `run()`: map `RunAgentInput` → engine adapter invocation, translate the normalized `EngineEvent` stream to AG-UI `BaseEvent`s (text start/content/end, tool call start/args/end/result, state deltas), persist every event to `data/threads/{threadId}.jsonl` as it flows. `connect()`: re-hydrate the thread from JSONL before delegating to `super.connect()` so reloads replay history. `stop()`: call the adapter's abort path (mirror `InMemoryAgentRunner.stop`'s non-throwing semantics). Throw `"Thread already running"` on concurrent `run()` for the same threadId (matches built-in behavior).
- Because the official docs name subclassing `InMemoryAgentRunner` "the most common customization" (canonical example: AWS `AgentCoreRunner`), and `AgentRunner`'s 4-method contract maps 1:1 to the runtime's HTTP routes.
- The runtime clones the registered agent per request, so the runner receives `threadId`, the cloned agent, `RunAgentInput`, and `persistedInputMessages` — the bridge needs no extra plumbing for per-thread state.

**If a page reload connects to a thread the runner has never run (existing JSONL thread):**
- `connect()` must handle "connect before any run" explicitly: load the JSONL, replay historic events, and let the runtime reconcile (the AgentCoreRunner docs show synthesizing missing tool-call results during replay). Otherwise `POST /agent/:id/connect` returns 404/error on first page load of an old thread.
- Because this is the documented failure mode of custom runners; Railyin's legacy import makes it certain.

**If the agent pauses for a decision (decision_request):**
- Bridge emits a `RUN_FINISHED` event with `outcome: {type:"interrupt", interrupts:[{id, reason:"decision_request", message, metadata:{...options}}]}` and the run ends cleanly. Client `useInterrupt` renders the decision card in `<CopilotChat>`'s `#interrupt` slot; `resolveInterrupt(payload)` starts a resume run whose `RunAgentInput.resume` carries `{interrupt_id, status:"resolved", payload}`. The bridge maps the payload back to the decision-request workflow. Runs pause instead of ending — matches the existing decision UX.
- Because that is the current AG-UI interrupt standard (legacy `on_interrupt` custom event is deprecated in favor of the interrupt outcome + resume entries).

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@ag-ui/core@0.0.57` | `@ag-ui/client@0.0.57`, `@copilotkit/vue@1.66.4` | `@copilotkit/vue@1.66.4` depends on `@ag-ui/core@0.0.57` + `@ag-ui/client@0.0.57` **exactly** — do not bump AG-UI independently or types will drift from the runtime. |
| `@copilotkit/runtime@1.66.4` | `@copilotkit/vue@1.66.4` | Keep both on the same release line; the frontend proxy contract (`/info` → `AbstractAgent` proxy) is version-sensitive. |
| `@copilotkit/runtime` | `rxjs@7.x` (peer) | `AgentRunner` types are `Observable<BaseEvent>` from rxjs. |
| `@copilotkit/vue@1.66.4` | `vue >= 3.3` | Peer requirement; Railyin's Vue 3 is fine. |
| `@copilotkit/vue@1.66.4` | `zod ^3.25` (transitive) | Pulled via `@ag-ui/core`; keep a single zod version in the tree. |
| `@copilotkit/runtime` peers | `openai`, `anthropic`, `langchain*`, `groq` — **optional** | Only needed if using `BuiltInAgent`/framework agents; a custom runner + engine adapters needs none of them. |

## Sources

- [Context7 `/copilotkit/copilotkit`](https://github.com/copilotkit/copilotkit) — `packages/runtime/skills/runtime/references/agent-runners.md` (AgentRunner contract, InMemory/Sqlite runners, "Thread already running"), `agent-runners-custom.md`, `setup-endpoint.md` (hono/express/fetch-native handlers), `runtime-architecture.md` (route table, runner options, Intelligence mode), `packages/vue/README.md` + `showcase/shell-docs` Vue reference (components/composables, provider props, `useThreads`, `useInterrupt`, `useCopilotKit`), HITL docs (`useInterrupt` vs `useHumanInTheLoop`), `multimodal-attachments.mdx` (InputContent parts, base64/URL upload)
- [Context7 `/ag-ui-protocol/ag-ui`](https://github.com/ag-ui-protocol/ag-ui) — `docs/concepts/events.mdx`, `docs/concepts/interrupts.mdx` (RUN_FINISHED interrupt outcome), LangGraph Python README (resume entries; `forwarded_props.command.resume` deprecated), SDK overviews (client event handling)
- [docs.showcase.copilotkit.ai useThreads reference](https://docs.showcase.copilotkit.ai/reference/v2/hooks/useThreads) — "only activates when the connected runtime advertises compatible REST thread endpoints"; self-managed runners don't provide the contract — **HIGH confidence (official docs)**
- [docs.showcase.copilotkit.ai AgentRunner and persistence](https://docs.showcase.copilotkit.ai/a2a/backend/agent-runner) — subclass-InMemoryAgentRunner pattern, connect-before-run pitfall, AWS AgentCoreRunner example — **HIGH confidence (official docs)**
- [docs.copilotkit.ai/langgraph-python/threads](https://docs.copilotkit.ai/langgraph-python/threads) — Rich Threads = Enterprise Intelligence (cloud or k8s self-host); self-hosting requirements — **HIGH confidence**
- GitHub issues: [#1169](https://github.com/CopilotKit/CopilotKit/issues/1169) (Vue support saga — shipped June 2026), [#6104](https://github.com/CopilotKit/CopilotKit/issues/6104) (Vue attachments structuredClone bug), [#6125](https://github.com/CopilotKit/CopilotKit/issues/6125) (Vue `cloneForThread`, docs mismatch) — **MEDIUM confidence (community reports)**
- npm registry (verified 2026-08-08): `@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57`, `@copilotkit/runtime@1.66.4`, `@copilotkit/vue@1.66.4`, `@copilotkit/react-core@1.66.4`, `@copilotkit/sqlite-runner@1.66.4`, `rxjs@7.8.2`, peer deps (vue >=3.3, runtime SDK peers optional)

---
*Stack research for: AG-UI + CopilotKit chat stack migration (Railyin milestone)*
*Researched: 2026-08-08*
