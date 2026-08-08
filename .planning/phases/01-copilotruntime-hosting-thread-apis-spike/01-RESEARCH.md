# Phase 1: CopilotRuntime Hosting & Thread APIs (Spike) - Research

**Researched:** 2026-08-08
**Domain:** Self-hosted CopilotRuntime hosting in Bun.serve, AG-UI/SSE wire protocol, spike probe + fixture validation
**Confidence:** HIGH (wire contract verified against the actual published package sources of the pinned versions)

## Summary

This is a **spike phase**: the deliverable is *evidence* — a working probe proving run/connect/stop over SSE on a real Bun server, validated mock fixtures, exact version pins, and a recorded fetch-native-vs-hono decision — not production code. The research therefore focused on (a) verifying the pinned stack against current reality, and (b) nailing down the exact wire contract the spike must prove, from the **actual published sources of `@copilotkit/runtime@1.66.4`, `@ag-ui/client@0.0.57`, `@ag-ui/encoder@0.0.57`** (fetched from the npm CDN, not docs).

All four pinned versions exist on npm and the dependency chain is exact: `@copilotkit/runtime@1.66.4` depends on `@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57`, `@ag-ui/encoder@0.0.57` **with exact (unranged) pins**, confirming D-09 ("do not bump AG-UI independently"). The fetch-native handler exists exactly as STACK.md predicted: `createCopilotRuntimeHandler({ runtime, basePath, mode = "multi-route", cors, hooks })` from `@copilotkit/runtime/v2`, designed for `Bun.serve({ fetch: handler })` — zero framework dependencies, mounting into Railyin's existing fetch handler is a prefix dispatch. The route table was verified from the 1.66.4 router source: `POST /agent/:agentId/run`, `POST /agent/:agentId/connect`, **`POST /agent/:agentId/stop/:threadId`** (threadId in the path — this resolves ARCHITECTURE.md's open question), `GET /info`; plus thread/memory routes (see State of the Art — a material discovery).

The SSE contract is now fully specified from source: responses are `200` with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`; every event is framed by `EventEncoder.encode()` as exactly `` `data: ${JSON.stringify(event)}\n\n` `` (no `event:`/`id:` fields; no NDJSON branch in 1.66.4 — the earlier "content negotiation" note in STACK.md is outdated for this version). The client (`@ag-ui/client`) POSTs `RunAgentInput` as JSON with `Accept: text/event-stream` and parses SSE frames by splitting on `\n\n`, and `verifyEvents` enforces strict run lifecycle (first event must be `RUN_STARTED`; `RUN_FINISHED`/`RUN_ERROR` close the run) — the probe agent and the mock fixtures MUST emit valid lifecycle sequences or the client rejects the stream.

For HOST-02 (the idle-timeout killer), Bun's official docs and SSE guide are unambiguous: `Bun.serve` closes connections after `idleTimeout` seconds of inactivity (default 10; Railyin sets 30), "SSE streams are often quiet between events", and the canonical mitigation is the per-request **`server.timeout(req, 0)`** override (0 = disabled; global `idleTimeout` max is 255 so "0" is the only true disable). The spike's composition-root must call `server.timeout(req, 0)` for `/api/copilotkit/*` requests before delegating to the runtime handler, and prove survival across a >30s scripted silence.

Finally, a discovery that materially affects D-08/CHAT-08 (Phase 4): in 1.66.4, `InMemoryAgentRunner` sets `ɵsupportsLocalThreadEndpoints = true`, so a self-hosted runtime **advertises `threadEndpoints.list`/`inspect` in `/info` and serves `GET /threads` (→ `{threads, nextCursor: null}` via `runner.listThreads()`) without Intelligence** — the earlier research's "thread routes are Intelligence-only" claim is outdated for this version. Mutations (`threads/update|archive|subscribe`) remain 422 without Intelligence. The spike must record the actual `/info` JSON and `GET /threads` behavior in PROJECT.md as the Phase 4 contract evidence.

**Primary recommendation:** mount `createCopilotRuntimeHandler` (fetch-native, `/v2` import) prefix-first in the `Bun.serve` fetch handler with `server.timeout(req, 0)` on copilotkit paths; prove run/connect/stop with a deterministic `ScriptedAgent extends AbstractAgent` (emitting verbatim-verified AG-UI event shapes, including a long-silence mode); probe over raw SSE fetch (wire-level evidence) plus `HttpAgent` (typed-client evidence); validate fixtures by capturing real server SSE text and diffing it against fixture-emitted SSE text for the same scenario; update PROJECT.md with the handler decision, version pins, `/info` capability JSON, and idle-timeout configuration as HOST-03 evidence.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use the fetch-native `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2` mounted directly into the existing `Bun.serve` fetch handler — NOT hono. Research evidence (STACK.md §Stack Patterns) contradicts PROJECT.md's earlier hono assumption: the fetch handler is Bun/Deno/Workers-native, adds zero framework dependencies, and the app is single-process same-origin. — **Reversibility:** reversible — swapping to `createCopilotHonoHandler` later is a one-line change in the composition root.
- **D-02:** Mount the runtime under the `/api/copilotkit/*` path prefix in multi-route default mode (run/connect/stop/info routes), keeping the existing `/api/*` RPC namespace coherent. — **Reversibility:** reversible — the prefix is a mount-time constant.
- **D-03:** Same-origin serving — the Vue SPA and the runtime share one origin. No CORS setup or extra server process. Reconfirm during the spike that no CORS options are needed.
- **D-04:** Bun.serve `idleTimeout` (default 30s) is a known SSE killer during long agent silences — the spike MUST verify stream survival and record the working configuration (explicit high/zero idle timeout and/or SSE-appropriate handling) in PROJECT.md as evidence for HOST-02.
- **D-05:** The run/connect/stop round trip is proven with a scripted/test agent (the existing mock engine `src/bun/testing/mock-engine.ts` pattern) — deterministic, no API keys, no network. Real-engine bridging is Phase 2.
- **D-06:** The spike verifies the "connect to a thread that never ran returns a valid empty conversation snapshot" contract on the real runtime (precursor to RUNR-06 in Phase 2).
- **D-07:** Mock runtime fixtures (`mock-runtime`/`mock-agui`) are validated against the real server in this phase (success criterion 5) and become the E2E foundation consumed by Phase 6. Extend `e2e/ui/fixtures/mock-api.ts` in the established pattern.
- **D-08:** `useThreads` is NOT usable against a self-hosted runtime (Intelligence-only per research). The own thread-index endpoint is Phase 4 (CHAT-08) — out of scope here. The spike only verifies what the runtime's own thread routes do so the Phase 4 contract can be written against evidence.
- **D-09:** Pin exact versions: `@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57`, `@copilotkit/runtime@1.66.4`, `@copilotkit/vue@1.66.4` (runtime+vue must stay on the same release line; do NOT bump AG-UI independently — types drift). — **Reversibility:** reversible — version bump.
- **D-10:** CopilotKit Vue is early-access — the spike does not consume the Vue SDK; it establishes the package.json pins and any install-time findings so Phase 5 can wrap usage in thin local components.

### the agent's Discretion

- Exact fixture implementation shape (mock SSE framing, event sequence helpers) — researcher/planner picks within the existing `mock-api.ts`/`mock-ws.ts` conventions.
- Whether to keep spike probe code as a script or fold it into `e2e/api/fixtures/` — planner decides; must not pollute production `src/bun/`.

### Deferred Ideas (OUT OF SCOPE)

- Own thread-index endpoint (`GET /api/threads`) — Phase 4 (CHAT-08), contract written from Phase 1 evidence of runtime thread-route behavior.
- Regenerate/retry API verification — Phase 5 concern; JSONL replay fallback if unconfirmed.
- hono handler — only if the app later grows real HTTP middleware needs (auth, CORS for a remote client).
- None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOST-01 | CopilotRuntime is mounted inside the existing Bun.serve server (single origin, self-hosted, no extra server process) | `createCopilotRuntimeHandler` verified in `@copilotkit/runtime@1.66.4/dist/v2/runtime/core/fetch-handler.mjs` — options `{runtime, basePath, mode="multi-route", cors, hooks}`; designed for `Bun.serve({fetch: handler})`; mount = prefix dispatch in `src/bun/index.ts` fetch (see Code Examples §Mounting). Route table verified from `fetch-router.mjs`. |
| HOST-02 | Long SSE streams survive extended agent silences (Bun `idleTimeout` tuned; no mid-stream kills) | Bun official docs/SSE guide: idleTimeout closes idle connections (default 10s, max 255, 0 disables); canonical mitigation `server.timeout(req, 0)` per request (verified via Bun docs). Spike must call it on `/api/copilotkit/*` paths and prove >30s-silence survival (see Code Examples §Mounting, Pitfalls §1). |
| HOST-03 | Runtime handler choice (fetch-native vs hono) is resolved with evidence and matches the pinned stack | Fetch-native handler verified to exist in `/v2` with the documented signature; hono handler (`createCopilotHonoHandler`) verified as the alternative from `/v2` (re-exported). Dependency pins verified exact on npm (`runtime`→`@ag-ui/*@0.0.57` exact). Spike records evidence in PROJECT.md (fetch-native chosen; zero deps; reversible). |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Bun is the runtime/package manager: `bun install`, `bun run dev`, `bun run prod`, `bun run build`. Dev defaults to in-memory DB; `--real-db` persists; `--port=3001` changes port.
- Testing: backend + API tests run under **vitest via `bun test`** (`bun test src/bun --timeout 20000`, `bun test e2e/api --timeout 30000`); UI tests are Playwright against `dist/` via `vite preview` with all `/api/*` mocked via `page.route()` (`e2e/ui/fixtures/mock-api.ts`). New API tests go in `e2e/api/`.
- Architecture: composition root is `src/bun/index.ts` (fetch handler, `/ws` upgrades, graceful shutdown, engine factory map). Shared contract lives in `src/shared/rpc-types.ts` — the runtime mount is an exception (it speaks AG-UI, not RPC); keep that boundary documented.
- Conventions: config-driven behavior (YAML); task movement goes through `tasks.transition`; conversation UI has two layers (persisted rows + live stream blocks) — the runtime mount must NOT route through the legacy stream pipeline this phase (no bridge yet, per CONTEXT.md).
- Path aliases: `@` → `src/mainview/`, `@shared` → `src/shared/`, `@bun` → `src/bun/` (vitest.config.ts).
- Playwright runs headless/parallel; `webServer` starts `vite preview` on `dist/` — the runtime probe belongs on the API-test side (real server), not UI tests.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Runtime hosting (run/connect/stop/SSE) | API / Backend | — | `createCopilotRuntimeHandler` runs inside `src/bun/index.ts`'s existing Bun.serve fetch — same process, same origin (D-02/D-03). No browser-side responsibility. |
| SSE wire protocol (framing, lifecycle) | API / Backend | — | Verified in-package: `EventEncoder.encode()` (`@ag-ui/encoder@0.0.57`) and runtime `sse-response.mjs` own framing; client (`@ag-ui/client`) validates lifecycle. The backend owns correct emission; the fixture layer must replicate it verbatim. |
| Thread state (in-memory) | API / Backend (runtime-owned) | — | `InMemoryAgentRunner` keeps threads in a **process-global** `ɵBoundedThreadStore` — runtime-internal; Railyin must not re-implement. Spike only observes `GET /threads`/`/info` (D-08 evidence). |
| Probe/deterministic agent | API / Backend (test seam) | — | `ScriptedAgent extends AbstractAgent` (mock-engine pattern, D-05) — registered only in the spike server config, never in production agent map. |
| Mock runtime fixtures for future UI E2E | CDN / Static (test-only) | — | `mock-runtime`/`mock-agui` fixtures live in `e2e/ui/fixtures/` (page.route interception of `/api/copilotkit/*`), validated against real server (D-07). Browser tier consumes mocked streams only. |
| idleTimeout survival | API / Backend | — | `server.timeout(req, 0)` per-request in the Bun fetch handler before delegating to the copilotkit handler (HOST-02). |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @copilotkit/runtime | 1.66.4 (exact pin, D-09) | Self-hosted CopilotRuntime: `CopilotRuntime` + `createCopilotRuntimeHandler` (fetch-native, `/v2` import) | Official self-hosted runtime; fetch-native handler is Bun-native (verified in dist source); locked decision D-01 |
| @ag-ui/client | 0.0.57 (exact pin) | `AbstractAgent` base class for the ScriptedAgent; `HttpAgent` typed probe client | Official AG-UI TS client; runtime's own `cloneAgentForRequest` requires agents to be `AbstractAgent` (verified in `agent-utils.mjs`) |
| @ag-ui/core | 0.0.57 (exact pin) | AG-UI types + zod schemas (`RunAgentInputSchema`, event types) | Official protocol package; transitive dep of runtime+vue with exact pin |
| @ag-ui/encoder | 0.0.57 (exact pin) | `EventEncoder` — SSE frame encoding `data: {json}\n\n` | Official protocol encoder; used by the runtime itself — the fixtures' single source of truth for framing |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @copilotkit/vue | 1.66.4 (pin only, D-10) | Vue SDK (`useChat`, `useThreads`) — **NOT consumed this phase** | Phase 5 wraps it in thin local components; this phase only locks the pin + install-time findings |
| rxjs | ^7.8 (runtime pins 7.8.1 exact) | Observable plumbing inside runtime/client; Railyin need not import it directly | Only if the ScriptedAgent or fixtures need it — prefer plain generators/EventEmitter |
| zod | project has `^4.0.0`; runtime/vue expect `^3.23.3` / `^3.25.75` | Schema validation inside runtime | Do NOT import project zod for AG-UI validation — bun nests zod@3 under copilotkit; treat as an install-time finding (see Pitfalls §5) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| fetch-native `createCopilotRuntimeHandler` | hono `createCopilotHonoHandler` | hono adds a framework dep for middleware needs this app doesn't have (single-process same-origin, D-03); fetch handler is dependency-free and reversible later (HOST-03) |
| Raw SSE fetch probe | `HttpAgent` only | Raw fetch proves wire contract independently of client code; `HttpAgent` proves the typed client works against our server. Use both — raw for evidence, typed for client-compat |
| `bun add @copilotkit/runtime@1.66.4` via lockfile | manual pin edit | `bun add --exact` records the exact versions in package.json + bun.lock in one step; avoid hand-editing to prevent lockfile drift |

**Installation:**
```bash
bun add --exact @copilotkit/runtime@1.66.4 @ag-ui/client@0.0.57 @ag-ui/core@0.0.57 @ag-ui/encoder@0.0.57 @copilotkit/vue@1.66.4
```
Note: `@copilotkit/vue` is pinned as a **regular** dependency (Phase 5 consumes it in the app), not a devDependency — but it is NOT imported anywhere this phase (D-10).

**Version verification (npm registry, 2026-08-08):**
- `@ag-ui/core@0.0.57` — latest is 0.0.57 ✓ (verified via `npm view`)
- `@ag-ui/client@0.0.57` — latest 0.0.57 ✓
- `@ag-ui/encoder@0.0.57` — latest 0.0.57 ✓
- `@copilotkit/runtime@1.66.4` — latest 1.66.4 ✓, published 2026-08-07; deps verified exact: `@ag-ui/client@0.0.57`, `@ag-ui/core@0.0.57`, `@ag-ui/encoder@0.0.57`, `rxjs@7.8.1`, `zod@^3.23.3`
- `@copilotkit/vue@1.66.4` — latest 1.66.4 ✓, published 2026-08-07; deps verified exact: `@ag-ui/client@0.0.57`, `@ag-ui/core@0.0.57`, peer `vue >= 3.3.0` ✓ (project has Vue 3)

## Package Legitimacy Audit

> Run via `gsd-tools query package-legitimacy check` on npm, cross-checked with `npm view` (versions, publish dates, deps, postinstall).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| @ag-ui/core@0.0.57 | npm | ~2 mo (2026-06-12) | — | github.com/ag-ui/ag-ui | OK | Approved |
| @ag-ui/client@0.0.57 | npm | ~2 mo | — | github.com/ag-ui/ag-ui | OK | Approved |
| @ag-ui/encoder@0.0.57 | npm | ~2 mo | — | github.com/ag-ui/ag-ui | OK | Approved |
| @copilotkit/runtime@1.66.4 | npm | 1 day (2026-08-07) | 313k/wk | github.com/CopilotKit/CopilotKit | SUS (too-new version) | Flagged — version-freshness only; official repo + huge download base; D-09 locked by user |
| @copilotkit/vue@1.66.4 | npm | 1 day (2026-08-07) | 5.4k/wk | github.com/CopilotKit/CopilotKit | SUS (too-new, early-access) | Flagged — planner adds `checkpoint:human-verify` before install; D-10 acknowledged early-access risk |
| rxjs (transitive, 7.8.1) | npm | 7 yrs | ~65M/wk | github.com/ReactiveX/rxjs | OK | Approved (runtime dep, not direct) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `@copilotkit/runtime@1.66.4`, `@copilotkit/vue@1.66.4` — both flagged purely on the "too-new" signal (published 2026-08-07, 1 day before research). Both are from the official CopilotKit/CopilotKit repository (verified), versions were explicitly chosen by the user in discuss (D-09/D-10), and the runtime's `dist/` was downloaded and inspected from the npm CDN this session (all wire-contract claims in this document are from that inspected source). Postinstall scripts: none (`npm view <pkg> scripts` empty). Recommended: keep the pins; the planner may add a single cheap `checkpoint:human-verify` confirming the 1.66.4 release before `bun add`, per protocol.

## Architecture Patterns

### System Architecture Diagram

```
Browser (Vue SPA, dev server)                 Bun.serve (single process, same origin)
┌──────────────────────────────┐              ┌──────────────────────────────────────────────┐
│ future @copilotkit/vue       │              │ src/bun/index.ts fetch handler               │
│ useChat/useThreads (P5)      │              │   ├─ /api/*            → existing RPC router │
└──────────┬───────────────────┘              │   ├─ /ws               → WebSocket upgrade   │
           │ HTTP POST {RunAgentInput}        │   ├─ /api/copilotkit/* → server.timeout(req, │
           │ Accept: text/event-stream        │   │                    0) + createCopilot     │
           │ (also WS in future P5)           │   │                    RuntimeHandler        │
           ▼                                  │   │    ├─ POST /agent/:agentId/run          │
           │                                  │   │    ├─ POST /agent/:agentId/connect      │
           │  SSE: data:{AG-UI event}\n\n     │   │    ├─ POST /agent/:agentId/stop/:threadId│
           │                                  │   │    └─ GET  /info                         │
           │                                  │   └── CopilotRuntime                         │
           │                                  │        ├─ runner: InMemoryAgentRunner        │
           │                                  │        │   └─ ɵGLOBAL_STORE (threads, proc-  │
           │                                  │        │      global)                        │
           │                                  │        └─ agents: { default: ScriptedAgent } │
           │                                  │                  (spike-only; emits scripted │
           │                                  │                   AG-UI events, optional     │
           │                                  │                   long silence for HOST-02)   │
           │                                  └──────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ Probe (e2e/api): raw fetch   │   wire-level evidence (HOST-01/02)
│ + HttpAgent (typed client)   │   runs in bun:test via startServer() fixture
└──────────────────────────────┘

┌──────────────────────────────────────────────┐
│ e2e/ui fixtures (D-07, validated this phase): │
│ mock-runtime / mock-agui  → page.route()      │
│ emits IDENTICAL SSE text as the real server   │
│ (validated by text-diff capture, §Pattern 3)  │
└──────────────────────────────────────────────┘
```

**Trace the primary use case:** probe POSTs `RunAgentInput` (`{threadId, runId, tools, context, forwardedProps, state, messages, resume?}` — verified client `prepareRunAgentInput`) as JSON with `Accept: text/event-stream` → fetch handler calls `server.timeout(req, 0)` → `createCopilotRuntimeHandler` → router suffix-matches `POST /agent/default/run` → runtime parses via `RunAgentInputSchema` (400 on invalid) → `runner.run()` → ScriptedAgent emits `RUN_STARTED` → `TEXT_MESSAGE_START/CONTENT/END` (optional silence window) → `RUN_FINISHED` → `finalizeRunEvents` → `EventEncoder.encode` frames each event → SSE stream closes on complete. Stop: `POST /agent/default/stop/:threadId` → `{stopped: true, interrupt: {type: RUN_ERROR, message: "Run stopped by user", code: "STOPPED"}}` or idempotent `{stopped: false}`.

### Recommended Project Structure (spike scope — probe code outside production src/)

```
e2e/api/
├── fixtures/server.ts          # existing startServer() — reuse as-is
└── copilotkit/                 # NEW (this phase)
    ├── probe-agent.ts          # ScriptedAgent (AbstractAgent) — emits scripted events
    ├── capture-real.ts         # script: run scenario against real server, dump SSE frames
    ├── sse-text-diff.test.ts   # assert fixture text == captured real text (D-07 validation)
    └── copilotkit.test.ts      # HOST-01 info/run/connect/stop + HOST-02 silence tests
src/bun/index.ts                # EDIT: prefix-dispatch + server.timeout(req,0) (HOST-01/02)
e2e/ui/fixtures/
├── mock-api.ts                 # EDIT (D-07): add /api/copilotkit/* routes
└── mock-agui.ts                # NEW: SSE fixture for future UI tests (validated by diff)
```

### Pattern 1: Prefix-dispatch mount in the existing Bun fetch handler
**What:** Mount the fetch-native handler inside `src/bun/index.ts` by routing `/api/copilotkit/*` requests to `createCopilotRuntimeHandler(...)` before the existing RPC router, and disable the idle timeout for those requests with `server.timeout(req, 0)`.
**When to use:** Any Bun.serve app adding CopilotRuntime self-hosted (single process, same origin).
**Example:** See Code Examples §Mounting (verified handler API; mount order matters — check the copilotkit prefix before the `/api/*` RPC router since RPC would 404 unknown paths).

### Pattern 2: ScriptedAgent — deterministic AG-UI producer
**What:** A test-only `AbstractAgent` subclass that yields a scripted event sequence per run (`RUN_STARTED` → messages → optional silent pause → `RUN_FINISHED`), driven by an in-memory script queue, mirroring `src/bun/testing/mock-engine.ts`.
**When to use:** Any phase needing deterministic agent behavior (this spike; later real-engine tests in Phase 2 can reuse).
**Why:** The runtime does NOT synthesize `RUN_STARTED` (verified: `runtime.run()` just forwards runner events + `finalizeRunEvents` appends `RUN_FINISHED`/`RUN_ERROR`) — the agent MUST emit `RUN_STARTED` first, or the client's `verifyEvents` rejects the stream ("First event must be 'RUN_STARTED'").

### Pattern 3: Fixture validation by SSE text diff (D-07)
**What:** Run the identical scenario twice: (a) against the real server capturing the raw SSE body text; (b) through the `page.route()` fixture emitting its constructed frames. Assert byte-identical `data:` lines.
**When to use:** Validating any mock that must mirror a real wire protocol (SSE framing, JSON bodies).
**Why:** Framing details (`data: {json}\n\n`, no `event:`/`id:` fields, connection headers) are exactly what hand-rolled mocks get wrong; diffing against real captured text catches it once, mechanically.

### Anti-Patterns to Avoid
- **Consuming `@copilotkit/vue` this phase (D-10):** early-access SDK; pin only, wrap in Phase 5.
- **Hand-constructing AG-UI events without the zod schemas:** event payloads must match `@ag-ui/core` schemas exactly (`messageId`, `delta`, `toolCallId`, …); use `@ag-ui/encoder` for framing so fixtures can never drift from the wire format.
- **Registering ScriptedAgent as the production agent map:** the spike server must register it only when a probe env flag is set (e.g. reusing `RAILYN_FORCE_MEMORY_DB`-style env gating or a dedicated `RAILYN_COPILOTKIT_PROBE=1`), so `bun run prod` never exposes the fake agent.
- **Reading `/api/copilotkit/*` through the RPC router:** the runtime's router is suffix-based on the raw URL; the existing `/api/*` router must not swallow these paths first (mount order).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE frame encoding | string templates like `` `data: ${JSON.stringify(e)}\n\n` `` in fixtures | `@ag-ui/encoder` `EventEncoder` (or the verified verbatim format, see Code Examples §SSE framing) | The runtime itself uses `EventEncoder` — fixtures that import it can never drift from wire format; one source of truth |
| AG-UI event construction | ad-hoc `{type, payload}` objects | `@ag-ui/core` types + `RunAgentInputSchema` | Client `verifyEvents` + runtime `parseRunRequest` enforce exact shapes; typo'd `messageId`/`delta` fields break silently at parse |
| Run/thread lifecycle | reimplementing concurrency, thread store, stop semantics | `InMemoryAgentRunner` (runtime default) | Process-global `ɵBoundedThreadStore`, "Thread already running" concurrency guard, idempotent stop — already battle-tested in-package |
| HTTP/SDK client for probes | raw fetch for the *client-compat* claim | `@ag-ui/client` `HttpAgent` (in addition to raw fetch evidence) | `HttpAgent` encodes `prepareRunAgentInput` + abort semantics + `verifyEvents` — proving the typed client works against our server is the goal |

**Key insight:** the wire protocol is the contract; every hand-rolled approximation (fixture framing, event shapes, lifecycle) is a source of drift that the text-diff validation (Pattern 3) exists to catch.

## Common Pitfalls

### Pitfall 1: Bun idleTimeout silently kills quiet SSE streams (HOST-02)
**What goes wrong:** A run with an agent pause > `idleTimeout` (30s in Railyin) gets its connection closed by Bun mid-stream; the client sees a truncated stream with no `RUN_FINISHED`; `verifyEvents` surfaces "stream closed" style errors.
**Why it happens:** Verified from Bun docs — "SSE streams are often quiet between events. By default, `Bun.serve` closes connections after 10 seconds of inactivity." `idleTimeout` default 10s, **max 255**, and only 0 disables; Railyin's global 30s still kills longer silences.
**How to avoid:** In the fetch handler, before delegating a `/api/copilotkit/*` request: `server.timeout(req, 0)` (per-request override; 0 = disabled). Keep the global `idleTimeout: 30` for the rest of the app.
**Warning signs:** CI/e2e tests that hang then fail with `TypeError: fetch failed` / abrupt stream end exactly at ~30s of silence.

### Pitfall 2: Client lifecycle validation rejects nonconforming event order
**What goes wrong:** Probe agent or mock fixture emits events without `RUN_STARTED` first, or keeps emitting after `RUN_FINISHED` — client throws ("First event must be 'RUN_STARTED'") and the run is rejected.
**Why it happens:** `verifyEvents` (in `@ag-ui/client` HttpAgent/parseSSEStream path, verified in source) enforces the run lifecycle: first = `RUN_STARTED`, close on `RUN_FINISHED`/`RUN_ERROR`. The **runtime does not synthesize RUN_STARTED** — the agent must emit it (verified in `runtime.run()`/`finalizeRunEvents`).
**How to avoid:** ScriptedAgent emits `RUN_STARTED` first; fixtures replay the exact captured sequence (Pattern 3).
**Warning signs:** Probe failing before the first content event arrives.

### Pitfall 3: Mount order — RPC router swallows /api/copilotkit/*
**What goes wrong:** Unknown `/api/*` paths hit the existing RPC router (404) or error handlers before the copilotkit prefix dispatch runs; `POST /agent/default/run` never reaches the runtime.
**Why it happens:** `createCopilotRuntimeHandler`'s router is suffix-matched on the raw URL — it must own the `/api/copilotkit` prefix; the composition root must check it first.
**How to avoid:** In `src/bun/index.ts` fetch: `if (req.url.includes("/api/copilotkit/")) return handler(req)` — before the RPC router — plus `server.timeout(req, 0)`.
**Warning signs:** HOST-01 probe gets 404/405 JSON from RPC instead of SSE.

### Pitfall 4: Stop route is `/agent/:agentId/stop/:threadId`, not `/stop`
**What goes wrong:** Hand-written tests use the old/assumed `POST .../stop` with threadId in the body → 404 `{error:"Not found"}`.
**Why it happens:** Earlier research (ARCHITECTURE.md) left the stop route shape as an open question; verified source (`fetch-router.mjs` + `handle-stop.mjs`) shows the threadId **in the path** for multi-route mode (single-route envelope mode uses `agent/stop` with a params `threadId`).
**How to avoid:** Use the verified route in the probe; document it in PROJECT.md.
**Warning signs:** Stop returns 404 while run/connect work.

### Pitfall 5: zod version collision (project `zod@^4` vs runtime `zod@^3.23.3`)
**What goes wrong:** Importing `zod` from the app root (v4) into copilotkit-adjacent code yields schema incompatibilities; or `bun add` dedupes incorrectly and runtime internals break.
**Why it happens:** `@copilotkit/runtime@1.66.4` requires `zod@^3.23.3`; Railyin's package.json already has `zod@^4.0.0`. npm/bun will nest zod@3 under copilotkit — correct, but only if nothing imports project zod into copilotkit code paths.
**How to avoid:** Never import app zod for AG-UI validation; rely on `@ag-ui/core` schemas (they bundle their own zod version). Record the install-time tree in the spike (HOST-03 evidence).
**Warning signs:** `bun install` warnings about peer/dep conflicts; runtime errors on `.parse` from zod version mismatch.

### Pitfall 6: Thread endpoints are process-local and ephemeral
**What goes wrong:** `GET /threads` (via `runner.listThreads()` fallback) returns fewer/other threads than expected, or connect-before-run yields no events.
**Why it happens:** `InMemoryAgentRunner` stores threads in a **process-global** in-memory store — nothing survives restart, and a fresh probe process has an empty store; `connect()` on a never-run thread **completes empty** (verified: ReplaySubject completes, no events).
**How to avoid:** Probe ordering: run first, then connect/GET /threads in the same process; treat "empty snapshot" as the verified contract (D-06) rather than a bug.
**Warning signs:** Connect test passes on second attempt / flaky across process restarts.

## Code Examples

> All examples below were verified against the published sources of the pinned versions (npm CDN, 2026-08-08) or official docs. File:line citations refer to the downloaded sources in the research session.

### Mounting the handler in Bun.serve (HOST-01/02) — verified API
```typescript
// src/bun/index.ts (composition root) — verified signature from
// @copilotkit/runtime@1.66.4/dist/v2/runtime/core/fetch-handler.mjs
import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { scriptedAgent } from "../testing/copilotkit-probe-agent"; // spike-only, env-gated

// runtime: agents map + runner; InMemoryAgentRunner is the default
const runtime = new CopilotRuntime({
  agents: { default: scriptedAgent },   // ScriptedAgent extends AbstractAgent
  // runner: optional; default InMemoryAgentRunner
});
const copilotHandler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",          // D-02 prefix
  mode: "multi-route",                  // default; D-02
  // cors: not needed — same-origin (D-03)
});

// inside Bun.serve({ fetch(req, server) { ... } }):
if (req.url.includes("/api/copilotkit/")) {
  server.timeout(req, 0);               // HOST-02: disable idle-timeout for SSE
  return copilotHandler(req);           // MUST precede the /api/* RPC router (Pitfall 3)
}
```

### ScriptedAgent skeleton — emits the verified event lifecycle (D-05)
```typescript
// Verified event shapes: @ag-ui/core@0.0.57 schemas (agui-client.mjs / encoder.mjs session)
// Runtime does NOT synthesize RUN_STARTED (runtime.mjs finalizeRunEvents) — agent emits it.
import { AbstractAgent } from "@ag-ui/client";   // BaseAgent subclass requirement (agent-utils.mjs cloneAgentForRequest)
import { EventType, RunAgentInput } from "@ag-ui/core";

class ScriptedAgent extends AbstractAgent {
  constructor() { super({ agentId: "default", description: "Spike probe agent" }); }
  async *run({ threadId, runId }: RunAgentInput): AsyncGenerator<Record<string, unknown>> {
    yield { type: EventType.RUN_STARTED, threadId, runId, input: {} };
    yield { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" };
    yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "hello" };
    yield { type: EventType.TEXT_MESSAGE_END, messageId: "m1" };
    if (script.silenceMs > 0) await sleep(script.silenceMs);   // HOST-02: >30s silence mode
    yield { type: EventType.RUN_FINISHED, threadId, runId, result: null };
  }
}
```

### Raw SSE probe — wire-level evidence (HOST-01)
```typescript
// Verified framing: EventEncoder.encode() = `data: ${JSON.stringify(event)}\n\n` (encoder.mjs)
const res = await fetch("http://127.0.0.1:PORT/api/copilotkit/agent/default/run", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "text/event-stream" },
  body: JSON.stringify({ threadId: "t1", runId: "r1", tools: [], context: [], forwardedProps: {}, state: [], messages: [] }),
});
assert.equal(res.status, 200);
assert.equal(res.headers.get("content-type"), "text/event-stream");
const frames = (await res.text()).split("\n\n").filter(Boolean);  // parseSSEStream splits on \n\n
assert.deepEqual(JSON.parse(frames[0].slice("data: ".length)), { type: "RUN_STARTED", ... });
```

### SSE framing — the exact wire format fixtures must emit (D-07)
```typescript
// @ag-ui/encoder@0.0.57 EventEncoder.encode(event) — verbatim from encoder.mjs
// `data: ${JSON.stringify(event)}\n\n` — single data line; no event:/id: fields
import { EventEncoder } from "@ag-ui/encoder";
const enc = new EventEncoder();                    // no accept arg → always SSE (getContentType)
const frame = enc.encode({ type: "RUN_STARTED", threadId: "t1", runId: "r1", input: {} });
// frame === 'data: {"type":"RUN_STARTED","threadId":"t1","runId":"r1","input":{}}\n\n'
```

### Stop route — verified multi-route path (resolves ARCHITECTURE.md open question)
```typescript
// fetch-router.mjs: POST /agent/:agentId/stop/:threadId  (threadId in PATH, multi-route mode)
// handle-stop.mjs responses (verbatim):
//   agent missing      → 404 {error: "Agent not found"}
//   running            → 200 {stopped: true, interrupt: {type: "RUN_ERROR", message: "Run stopped by user", code: "STOPPED"}}
//   not running        → 200 {stopped: false, message: `No active run for thread '${threadId}'.`}
//   runner.stop threw  → 500 {error: "Failed to stop agent"}
await fetch(`http://127.0.0.1:PORT/api/copilotkit/agent/default/stop/t1`, { method: "POST" });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Thread endpoints only with CopilotKitIntelligence | `InMemoryAgentRunner` advertises `ɵsupportsLocalThreadEndpoints=true` → `GET /threads` (list) + `GET /threads/events/:threadId` (inspect) work self-hosted; mutations (update/archive/subscribe) still 422 without Intelligence | 1.66.4 (verified in dist source this session) | **Material for D-08/CHAT-08:** the spike can capture real `/info` + `GET /threads` behavior for the Phase 4 contract — the earlier "Intelligence-only" claim (STACK.md/ARCHITECTURE.md) is outdated |
| SSE content negotiation (NDJSON/SSE) in runtime | 1.66.4 always emits SSE via `EventEncoder` (no accept header → `text/event-stream`); the encoder still supports protobuf/NDJSON but the runtime never opts in | 1.66.4 | Fixtures only need the `data:` framing; the "negotiation" note in STACK.md is obsolete for this version |
| Stop route shape unknown (`/agent/:id/stop`) | `POST /agent/:agentId/stop/:threadId` (multi-route, threadId in path) — verified | 1.66.4 | Probe/test code and Phase 2/6 fixtures use the verified route; documented in PROJECT.md |

**Deprecated/outdated:**
- **STACK.md's "Intelligence-only thread routes" claim** — replaced by the verified local-thread-endpoint fallback above (applies to `threads/list`, `threads/events/:threadId`; mutations still Intelligence-gated).
- **STACK.md's "SSE/NDJSON negotiation" note** — runtime 1.66.4 constructs `EventEncoder()` without an accept argument; output is always SSE.
- **ARCHITECTURE.md's open question on the stop route shape** — resolved: threadId in the path (multi-route).

## Assumptions Log

> All wire-contract claims in this document were verified against published package sources (`[VERIFIED]`) or official docs (`[CITED]`); the remaining assumptions are about the *spike environment*, not the protocol.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `bun add --exact` of the five pinned packages installs cleanly on bun 1.4.0 (zod@3 nests under copilotkit, no peer conflicts with Vue 3) | Standard Stack / Pitfall 5 | Install failure or dedupe issue — the spike's first task must verify `bun install` + `bun run build` still pass |
| A2 | `server.timeout(req, 0)` on Bun 1.4.0 behaves as documented (per-request idle-timeout override) | Code Examples §Mounting | If unavailable on 1.4.0, fallback = raise global `idleTimeout` + heartbeat notes; spike verifies empirically (HOST-02) |
| A3 | A custom `AbstractAgent` subclass registered in `CopilotRuntime({agents})` is served per-request via `cloneAgentForRequest` with the threadId/runId injected (verified in `agent-utils.mjs` for the runtime path; the class API itself is `[VERIFIED]` via npm sources) | Code Examples §ScriptedAgent | Wrong agent constructor contract → probe errors; the probe's first assertion is `/info` returning the agent + a minimal run |
| A4 | `@copilotkit/vue@1.66.4` `useThreads` activation is gated on runtime-advertised capability flags — exact criteria not verified client-side this phase (D-10: not consumed) | State of the Art / D-08 | Phase 5 may need a capability-flag tweak; Phase 4 owns the thread contract anyway — no impact this phase |
| A5 | Real-engine-independent claims (no API keys, no network) hold: ScriptedAgent + InMemoryAgentRunner need no external services | Environment Availability | If the runtime constructor eagerly initializes something network-bound — disproven by dist source; no network code found |

## Open Questions

1. **Does `GET /threads` + `GET /threads/events/:threadId` actually serve useful data for InMemoryAgentRunner in-process?**
   - What we know: `handleListThreads` falls back to `runner.listThreads()` when `supportsLocalThreadEndpoints(runner)` is true; `listThreads()` returns `{id, name: null, agentId, organizationId: "", createdById: "", archived: false, createdAt, updatedAt}` sorted by `updatedAt` desc, **skipping threads with no historic runs** (verified in `in-memory.mjs`).
   - What's unclear: end-to-end behavior on the real server (empty list on fresh process; does events/:threadId stream?).
   - Recommendation: spike records the actual responses (D-08 evidence for the Phase 4 contract); no decision needed now.

2. **Exact `server.timeout(req, 0)` semantics on bun 1.4.0 when the handler returns a `Response` built from a TransformStream.**
   - What we know: Bun docs prescribe it for SSE (HOST-02); the runtime's SSE response is a standard `Response` (verified).
   - What's unclear: whether the override must be applied before handler invocation (we do it before delegating — Pitfall-free by construction).
   - Recommendation: HOST-02 test asserts stream survival across a >30s silence; if it fails, fallback = raise global `idleTimeout` and record in PROJECT.md (D-04 allows either, evidence wins).

3. **Is `@copilotkit/vue@1.66.4` importable without React/other peer baggage?**
   - What we know: peer deps = `vue >= 3.3.0` only (verified via `npm view`); runtime deps include `katex`, `streamdown-vue`, `lucide-vue-next` (markdown-rendering deps, all Vue-native).
   - What's unclear: ESM/bundler quirks of the early-access SDK (D-10).
   - Recommendation: install-time finding only — `bun add` + typecheck; no consumption this phase.

## Environment Availability

> Spike is local-only (no external services). Skipping the full probe table is not warranted — the toolchain table is below.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bun | install/build/tests | ✓ | 1.4.0 | — |
| node | npm registry checks | ✓ | v20.20.1 | — |
| @ag-ui/core@0.0.57 | types/schemas | not yet installed | 0.0.57 on registry | pin install in spike task 1 |
| @ag-ui/client@0.0.57 | AbstractAgent/HttpAgent | not yet installed | 0.0.57 on registry | same |
| @ag-ui/encoder@0.0.57 | SSE framing | not yet installed | 0.0.57 on registry | same |
| @copilotkit/runtime@1.66.4 | CopilotRuntime + handler | not yet installed | 1.66.4 on registry | same |
| @copilotkit/vue@1.66.4 | pin only (D-10) | not yet installed | 1.66.4 on registry | same |
| vitest (via bun test) | e2e/api tests | ✓ | (project devDeps) | — |
| Playwright | UI E2E (not used this phase) | ✓ | 1.59.1 | — |

**Missing dependencies with no fallback:** none — the five packages are the phase's deliverable and install from npm (verified to exist at the pinned versions).

**Missing dependencies with fallback:** `server.timeout(req, 0)` if unsupported on bun 1.4.0 (A2) → global idleTimeout raise + recorded evidence.

## Validation Architecture

> `.planning/config.json` has `workflow.nyquist_validation: true` — validation section required. This is a spike: the "tests" are the evidence probes themselves; the map below is the minimum regression surface.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest via `bun test` (project standard) |
| Config file | vitest.config.ts (existing) |
| Quick run command | `bun test e2e/api/copilotkit --timeout 30000` |
| Full suite command | `bun test src/bun --timeout 20000 && bun test e2e/api --timeout 30000` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOST-01 | `GET /api/copilotkit/info` returns 200 JSON with `agents.default` + `mode: "sse"`; `POST .../agent/default/run` returns 200 `text/event-stream` with `RUN_STARTED` first frame; `.../stop/:threadId` returns `{stopped:true}` | integration (real server, `startServer()` fixture) | `bun test e2e/api/copilotkit/copilotkit.test.ts -x` | ❌ Wave 0 — new file |
| HOST-01 | `POST .../run` with malformed body → 400 `{error:"Invalid request body", details}` | integration | same file | ❌ Wave 0 |
| HOST-02 | Scripted silence >30s: SSE stream still alive after silence; events arrive after; stream closes with `RUN_FINISHED` | integration (real server; probe uses `server.timeout(req,0)` path) | same file | ❌ Wave 0 |
| HOST-02 | Without the `server.timeout(req,0)` override, the stream dies at idleTimeout (negative control — documents the mitigation) | integration (optional; skip if slow) | same file | ❌ Wave 0 |
| HOST-03 | package.json pins exactly `@ag-ui/*@0.0.57`, `@copilotkit/runtime@1.66.4`, `@copilotkit/vue@1.66.4`; `bun run build` green; decision + `/info` capability JSON recorded in PROJECT.md | unit (pin assertion) + manual (PROJECT.md record) | `bun run build` (manual) | ❌ Wave 0 — pin test file |
| D-06 | connect to never-run thread → 200 SSE with no events (empty completion), no error | integration | same file | ❌ Wave 0 |
| D-07 | fixture SSE text == captured real SSE text (text-diff) | integration (fixture validation) | `bun test e2e/api/copilotkit/sse-text-diff.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test e2e/api/copilotkit --timeout 30000` (and `bun run build` when deps change)
- **Per wave merge:** full suite above
- **Phase gate:** full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `e2e/api/copilotkit/copilotkit.test.ts` — HOST-01/02, D-06, stop-route, 400-path tests
- [ ] `e2e/api/copilotkit/sse-text-diff.test.ts` — D-07 fixture validation (fixture under `e2e/ui/fixtures/mock-agui.ts`)
- [ ] `e2e/api/copilotkit/probe-agent.ts` — ScriptedAgent (D-05)
- [ ] Pin-assertion test (e.g. `e2e/api/copilotkit/pins.test.ts` or fold into copilotkit.test.ts) — HOST-03
- [ ] No framework install needed (vitest present); no new shared fixtures beyond startServer() reuse

## Security Domain

> `.planning/config.json` — `security_enforcement: true` (absent counts as enabled). ASVS L1 is the baseline; this spike only mounts a **mock agent** with no credentials, so the exposure delta is minimal, but the mount is permanent infrastructure for future phases.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local single-user tool; no new auth surface (same-origin, loopback-only posture inherited from the existing app) |
| V3 Session Management | no | No sessions created by the runtime (stateless run/stop requests) |
| V4 Access Control | yes (partial) | The runtime agent map is registry-style (`agents: {default: ...}`) — spike registers ONLY the env-gated ScriptedAgent; production `bun run prod` must never register it (env gate, Pitfall: register via probe flag). Same-origin only (D-03); no CORS headers emitted (verify in probe — `Access-Control-Allow-Origin` absent) |
| V5 Input Validation | yes | RunAgentInput is zod-validated by the runtime (`RunAgentInputSchema.parse` → 400 `{error:"Invalid request body", details}` — verified). threadId/runId are opaque in-memory keys this phase (no filesystem/DB access — traversal risk arrives only with the Phase 2 JSONL runner; document the boundary) |
| V6 Cryptography | no | No new crypto surface; SSE is plaintext over localhost (consistent with existing app) |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed RunAgentInput flooding the runtime | Tampering / DoS | Runtime's zod parse → 400 (verified); probe asserts the 400 path; no unbounded work occurs pre-parse |
| Unauthorized local clients invoking the mock agent | Spoofing / Tampering | Same-origin + loopback posture as existing `/api/*` (the app already trusts localhost); no engine credentials exposed — ScriptedAgent has none. Document: Phase 2 real-engine bridge must add the same protections the existing `launch.run` endpoint uses (origin checks) |
| SSE endpoint used as a request-smuggling vector via prefix confusion | Tampering | Mount order in the composition root (copilotkit prefix checked BEFORE RPC router); probe asserts `/api/copilotkit/` unknown subpaths return the runtime's 404 `{error:"Not found"}`, not RPC 404s |

## Sources

### Primary (HIGH confidence) — [VERIFIED]
- **@copilotkit/runtime@1.66.4 dist sources (npm CDN, fetched this session):** `dist/v2/runtime/core/fetch-handler.mjs`, `fetch-router.mjs`, `runtime.mjs`, `handlers/handle-run.mjs`, `handle-connect.mjs`, `handle-stop.mjs`, `get-runtime-info.mjs`, `handlers/shared/agent-utils.mjs`, `sse-response.mjs`, `handlers/sse/run.mjs`, `handlers/sse/connect.mjs`, `runner/in-memory.mjs`, `runner/agent-runner.mjs`, `handlers/intelligence/threads.mjs` — route table, handler options, SSE framing, stop semantics, thread-endpoint fallback, RUN_STARTED non-synthesis, `server.timeout` guidance consumers
- **@ag-ui/encoder@0.0.57 `dist/index.mjs`** — `EventEncoder.encode()` verbatim (`data: {json}\n\n`)
- **@ag-ui/client@0.0.57 `dist/index.mjs`** — `AbstractAgent`, `HttpAgent`, `prepareRunAgentInput`, `verifyEvents` lifecycle rules, `parseSSEStream`
- **npm registry (`npm view`)** — version existence + latest at pin, publish dates (2026-06-12 / 2026-08-07), exact dependency pins, postinstall absence, peer deps (`vue >= 3.3.0`)
- **gsd-tools `package-legitimacy check`** — OK/SUS verdicts for all packages

### Secondary (MEDIUM confidence) — [CITED]
- **Bun official docs** (SSE guide + `Bun.serve` `idleTimeout` docs, via ctx7 `/oven-sh/bun`): "SSE streams are often quiet between events... closes connections after 10 seconds of inactivity", `idleTimeout` default 10 / max 255 / 0 disables, `server.timeout(req, 0)` per-request mitigation
- **ctx7 `/copilotkit/copilotkit` docs**: `CopilotRuntime` constructor options, `createCopilotRuntimeHandler` usage (fetch-native vs hono), SSE basics — consistent with source verification

### Tertiary (LOW confidence)
- None relied upon for wire claims; everything protocol-level was verified in package source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions, pins, deps, export maps verified on npm; handler API verified in dist source
- Architecture: HIGH — mount pattern, SSE framing, stop route, thread-endpoint fallback verified in dist source; only bun-1.4.0 runtime behavior of `server.timeout` remains for empirical proof (A2)
- Pitfalls: HIGH for protocol/behavior pitfalls (source-verified); MEDIUM for zod-nesting and bun install behaviors (A1/A2, install-time findings)

**Research date:** 2026-08-08
**Valid until:** 7 days (fast-moving — CopilotKit publishes ~daily; pins are locked for this milestone so freshness matters only for future phases)
