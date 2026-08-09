# Phase 2: AG-UI Bridge & RailyinAgentRunner - Research

**Researched:** 2026-08-09
**Domain:** AG-UI wire protocol, custom AgentRunner persistence, engine-event translation
**Confidence:** HIGH (all critical claims verified this session against the **installed** `@ag-ui/client@0.0.57` + `@copilotkit/runtime@1.66.4` sources and the Railyin codebase; prior-project research cited where relied upon)

## Summary

Phase 2 is the keystone of the chat-stack migration: `RailyinAgent` (an `AbstractAgent` subclass) translates `EngineEvent` → AG-UI `BaseEvent` through one pure `event-bridge.ts`, and `RailyinAgentRunner` (an `InMemoryAgentRunner` subclass) persists every emitted event to `data/threads/{threadId}.jsonl` and replays it on cold-start connect. All five engines keep working through the existing `ExecutionCoordinator`/`EngineRegistry` surface — the agent never touches engines directly.

This session verified the concrete API surface from the installed packages, correcting two prior-research claims: (1) the abstract method on `AbstractAgent@0.0.57` is **`run(input: RunAgentInput): Observable<BaseEvent>`** — not `runAgent(input, {onEvent})` (that's the built-in wrapper the runner calls); (2) a concurrent run does **not** surface as an HTTP 500 over SSE — the runner throws `"Thread already running"` synchronously but `createSseEventResponse` swallows the factory throw, so the client sees **HTTP 200 with an empty SSE body**. The runner lock is still the contract to test at the unit level; the client-side busy guard is the real protection.

The single most dangerous implementation detail found: **`AbstractAgent.clone()` copies only a fixed field list** (agentId, description, threadId, messages, state, debug fields, subscribers, middlewares, pendingInterrupts) — the per-request agent clone the runtime creates (`cloneAgentForRequest` → `agent.clone()`) would **lose injected constructor dependencies**. `RailyinAgent` MUST override `clone()` to carry its injected deps. Second: the base runner's `finalizeRunEvents` appends `RUN_ERROR "Run ended without emitting a terminal event"` when the agent stream ends without a terminal — the agent MUST emit `RUN_FINISHED`/`RUN_ERROR` itself (the Phase 1 probe already encodes this contract).

**Primary recommendation:** build `src/bun/copilotkit/` exactly as locked in CONTEXT.md (D-11), thread an optional `onEngineEvent`/`onRunEnd` callback through `ExecutionCoordinator.executeChatTurn` → `ChatExecutor.execute` → `StreamProcessor.consume()` (minimal-diff; preserves the existing DB dual-write for rollback; exact event ordering), and persist from the runner by piping `super.run()`'s observable through a `tap` so the JSONL log contains exactly what the client received (including the runner-patched `RUN_STARTED.input`).

## Project Constraints (from AGENTS.md)

- Backend tests run with `bun test src/bun --timeout 20000` (vitest-style imports); API e2e via `bun test e2e/api --timeout 30000`; path aliases `@` → `src/mainview/`, `@shared` → `src/shared/` (vitest.config.ts); no `@bun` alias in vitest config — Bun tests import relative paths.
- Shared contract discipline: `src/shared/rpc-types.ts` is the source of truth for the RPC surface. The CopilotRuntime mount is the documented exception — it speaks AG-UI, not RPC (Phase 1 CONTEXT.md).
- Config-driven workflow behavior; engines resolved through `EngineRegistry` + `allowed_engines` — no hardcoded engine logic (D-10).
- E2E discipline: UI tests mock everything (`page.route`); API tests always spawn the real server (`e2e/api/fixtures/server.ts`). The `RAILYN_COPILOTKIT_PROBE=1` env gate keeps the probe agent out of the production module graph.
- Default DB is in-memory only with `--memory-db`/`RAILYN_DB=:memory:`; `bun run prod` uses the SQLite file.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Bridge Architecture (where the translation lives)
- **D-01:** The bridge lives in `RailyinAgent` (extends `AbstractAgent` from `@ag-ui/client`), NOT in the runner. Matches ecosystem semantics (agent = execution, runner = lifecycle/persistence); the base runner's `run()` already wires `agent.runAgent(input, {onEvent})` → live `ReplaySubject` → `connect()` tail-subscription — hijacking `run()` forfeits that machinery. — **Reversibility:** costly — moving translation later touches the runner contract; architecture is research-backed (ARCHITECTURE.md).
- **D-02:** Translation is a pure module `event-bridge.ts` (`EngineEvent` → `BaseEvent`), unit-testable with no I/O — exactly one translation path (BRDG-01, no double-broadcast; the Claude `markClaudeExecution` hack disappears).
- **D-03:** Event mapping (from research): `token` → `TEXT_MESSAGE_CONTENT` (via chunk events), `reasoning` → `REASONING_*`, `tool_start` → `TOOL_CALL_START`, `tool_result` → `TOOL_CALL_RESULT`, `done` → `RUN_FINISHED` (base runner appends), `error` → `RUN_ERROR` (base runner appends on throw). RUN_STARTED must be emitted first (base runner supplements input if absent — verified in Phase 1).

#### Runner & Persistence (RailyinAgentRunner)
- **D-04:** `RailyinAgentRunner` extends `InMemoryAgentRunner` — the documented extension pattern (AWS AgentCoreRunner example). Override `run()` (persist, then `super.run`) and `connect()` (re-hydrate from JSONL, then `super.connect`). Known issue #3553: base `connect()` never reaches upstream persistence on cold start — the JSONL re-hydration IS the fix (RUNR-05).
- **D-05:** Persistence is append-only JSONL per thread at `data/threads/{threadId}.jsonl`; replay reads the event log (not snapshots — RUNR-05). JSONL store is a separate pure-ish module `jsonl-store.ts` (no constructor-visible deps). — **Reversibility:** reversible — file format is private to the store.
- **D-06:** Thread mapping (RUNR-03): `threadId = conversation.id` for card conversations; standalone sessions are threads without a taskId. Locked in PROJECT.md.
- **D-07:** connect on a never-run thread returns a valid empty conversation snapshot, not an error (RUNR-06) — verified contract in Phase 1.

#### Run Lifecycle Semantics
- **D-08:** Run locking (RUNR-04): a second concurrent run on the same thread is rejected — throw "Thread already running" (base runner contract; surfaces as 500 over SSE; clients busy-guard).
- **D-09:** Replayed tool calls synthesize `TOOL_CALL_RESULT` events so cards never show stale "running" state (RUNR-07) — research PITFALLS.md; engines that batch results need synthetic results on replay.
- **D-10:** Engine selection stays config-driven per workspace: the agent resolves the engine via the existing `EngineRegistry` + `allowed_engines` + model resolver (no hardcoded engine logic).

#### Code Location & Shape
- **D-11:** New directory `src/bun/copilotkit/` holding: `railyin-agent.ts` (AbstractAgent subclass), `event-bridge.ts` (pure translation), `railyin-runner.ts` (runner subclass), `jsonl-store.ts` (persistence). One additive directory keeps the ~800–1000 new lines reviewable, delete-able for rollback, and testable in isolation. — **Reversibility:** reversible — additive module.
- **D-12:** The runtime registration in `src/bun/index.ts` switches from the spike's probe `ScriptedAgent` to `RailyinAgent` + `RailyinAgentRunner`; the `RAILYN_COPILOTKIT_PROBE` env gate stays for e2e probe tests.

### the agent's Discretion
- Exact JSONL line schema (event JSON per line; metadata headers if needed).
- Replay ordering/compaction details (use `compactEvents` where applicable).
- How the agent calls the orchestrator (which executor entry point per run type — transition/chat) — planner maps `RunAgentInput` to the existing `ExecutionCoordinator` surface.

### Deferred Ideas (OUT OF SCOPE)
- Decision interrupts & resume (decision_request → RUN_FINISHED outcome interrupt + RunAgentInput.resume) — Phase 3 (RUNR-08).
- Own thread-index endpoint (`GET /api/threads` list) — Phase 4 (CHAT-08); Phase 1 proved runtime local fallback exists (`runner.listThreads()`, threadEndpoints.list) — verify reuse vs own endpoint.
- Cancel hardening per-engine (labeled "stopped") — v2 (CHAT-11).
- Regenerate/retry via JSONL replay — v2 (CHAT-10).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BRDG-01 | Engine `EngineEvent` deltas map to AG-UI events through exactly one translation path | `event-bridge.ts` pure module; mapping table verified against `EngineEvent` union (types.ts:20-50) and installed zod schemas; runner persists via `tap` on `super.run()` observable so no second translator exists |
| BRDG-02 | Engine thinking routes to `REASONING_*` events | `REASONING_MESSAGE_START/CONTENT/END` schemas verified (index.d.ts:9971-10033); reasoning card consumes these |
| BRDG-03 | Tool calls emit complete lifecycle (START/ARGS/END/RESULT) | All four schemas verified; `TOOL_CALL_RESULT.messageId` is REQUIRED; toolCallId namespacing needed for child/subagent calls; bridge synthesizes missing results at run end (D-09) |
| RUNR-01 | One AG-UI boundary for all five engines, per-workspace selection intact | Agent routes through `ExecutionCoordinator.executeChatTurn` which resolves engine via `EngineRegistry.resolveEngineForModel` (chat-executor.ts:94); no engine logic in agent |
| RUNR-02 | Conversations persist per-thread as JSONL via the custom runner | `jsonl-store.ts` at `<dataDir>/threads/{threadId}.jsonl`; `getDataDir()` = `RAILYN_DATA_DIR ?? ~/.railyn` (platform.ts:16-17); runner `run()` pipe-tap persists every event |
| RUNR-03 | Thread mapping: `threadId = conversation.id`; standalone sessions are threads without taskId | `conversations.id` is the key; `chatSessions.create` creates conversations with `task_id NULL` (chat-sessions.ts:52-60); validate `/^\d+$/` |
| RUNR-04 | Run locking — concurrent runs rejected with clear error | Inherited from `InMemoryAgentRunner.run()`: throws `Error("Thread already running")` (in-memory.mjs:299-300) when `super.run()` is called; over SSE it surfaces as 200+empty body (correction — see Pitfall 2) |
| RUNR-05 | Reconnect/reload replays full conversation from JSONL event log | `connect()` override: cold-start replay from file is the #3553 fix; replay shape = `compactEvents` + complete-tool-call pass (finalizeRunEvents-style) |
| RUNR-06 | connect-before-run returns valid empty conversation snapshot | Phase 1 test 5 verified: zero-frame 200 SSE (copilotkit.test.ts:127-135); runner must complete empty for unknown threads |
| RUNR-07 | Replayed tool calls synthesize `TOOL_CALL_RESULT` so no stale "running" cards | `finalizeRunEvents` synthesis pattern verified in @copilotkit/shared (finalize-events.mjs); bridge-level synthesis at run end keeps the log always complete |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| EngineEvent → AG-UI translation | API/Backend (event-bridge inside RailyinAgent) | — | D-01 locked: agent owns execution semantics; pure module is unit-testable with no I/O |
| Run lifecycle + JSONL persistence | API/Backend (RailyinAgentRunner) | — | Runner is the documented persistence seam; base runner already owns concurrency guard, compaction, live-tail |
| Engine execution (five engines) | API/Backend (existing Orchestrator/EngineRegistry) | — | Untouched; the agent routes through `ExecutionCoordinator` only (chat turns in this phase) |
| Thread identity (conversation.id ↔ threadId) | Database (conversations table) | API/Backend (mapper in agent) | `conversations.id` is the universal routing key; mapping is a DB lookup, not UI state |
| SSE transport + per-request agent clone | API/Backend (CopilotRuntime mount in index.ts) | — | Runtime handles SSE framing (`EventEncoder`), route matching, cloning; Railyin only swaps in `runner` + `agents` |
| Board `/ws` reactivity (task.updated etc.) | API/Backend (existing StreamProcessor → BroadcastChannel) | — | UNCHANGED — the AG-UI bridge ignores `task_updated`/`new_message`; no chat events move to /ws (UI-04) |

## Standard Stack

### Core (all already installed and pinned — no new packages required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ag-ui/client` | 0.0.57 (pin) | `AbstractAgent`, `BaseEvent`, `EventType` re-export, `compactEvents` | The runner contract + the class RailyinAgent extends; pinned by CopilotKit exactly |
| `@ag-ui/core` | 0.0.57 (pin) | `RunAgentInput`, event schemas (`EventSchemas`), `EventType` | Wire types + zod schemas for test-time event validation |
| `@copilotkit/runtime` | 1.66.4 (pin, `/v2` subpath) | `CopilotRuntime`, `InMemoryAgentRunner`, `createCopilotRuntimeHandler` | Runner base class + runtime mount; `CopilotRuntimeOptions.runner` verified (runtime.d.mts:152-153) |
| `rxjs` | 7.8.2 hoisted (nested 7.8.1 in @ag-ui/client) | `Observable<BaseEvent>` return type of `run()`/`connect()` | Required peer of the runner contract. NOT currently a direct dependency — see installation below |
| `bun:sqlite` (built-in) | — | conversations/chat_sessions/executions reads for thread mapping | Existing; do NOT use for chat threads (JSONL is the thread store) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@ag-ui/encoder` | 0.0.57 (pin) | `EventEncoder` SSE framing | Runtime-internal; tests only assert the `data: {json}\n\n` frame shape (parseSseFrames pattern, copilotkit.test.ts:38-43) |
| `@ag-ui/core` `EventSchemas` | 0.0.57 | zod-parse emitted events in unit tests | Validates bridge output without adding a zod dep (top-level zod is ^4.0.0; @ag-ui/core uses its own nested zod ^3.22) |
| `src/bun/pipeline/write-buffer.ts` (existing) | — | Buffered append for hot streams | Phase 4 hardening (crash tolerance); Phase 2 uses direct append — one user, per-event appends acceptable |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Callback tap (`onEngineEvent` through executeChatTurn) | New `executeChatTurnStreaming()` coordinator method returning `AsyncIterable<EngineEvent>` | Callback tap is minimal-diff (one optional param threaded through 4 layers), preserves StreamProcessor's DB writes (dual-write for rollback), exact in-loop ordering. Streaming-return needs an executor refactor and duplicates DB status updates |
| Direct `engine.execute()` from the agent | Routing through `executeChatTurn` | Bypassing the executor loses prompt assembly, cross-engine context, slash commands, DB state — rejected |
| Agent emits `RUN_STARTED` with input | Agent emits bare `RUN_STARTED`, runner patches | Emitting with input gives the agent full control of the persisted `input.messages` (user turn capture for replay); runner only patches when `input` is absent (in-memory.mjs:375-385) |

**Installation (only if making the rxjs import explicit — recommended):**
```bash
bun add rxjs@^7.8.2
```
Rationale: `RailyinAgent.run()` returns `Observable<BaseEvent>`; the probe already imports `from("rxjs")` (top-level 7.8.2) and casts to the nested-7.8.1 type (probe-agent.ts:56-63). It works via hoisting today but an explicit pin prevents dedupe surprises; extend `pins.test.ts` for it.

**Version verification (this session):** `@ag-ui/client@0.0.57` (nested dep rxjs 7.8.1), `@copilotkit/runtime@1.66.4`, hoisted `rxjs@7.8.2`, `@ag-ui/core@0.0.57` — all confirmed from `node_modules` package.json files; package.json pins verified (dependencies `"@ag-ui/client": "0.0.57"` etc.).

## Package Legitimacy Audit

No new external packages are installed in this phase — everything lives in `src/bun/copilotkit/` on top of the already-pinned Phase 1 stack. The only candidate addition is an explicit `rxjs` direct dependency (already present in the tree via hoisting).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| rxjs | npm | 10 yrs (published 2025-02-22 for 7.8.2) | ~98M/wk | github.com/reactivex/rxjs | OK (seam check) | Approved if explicit pin added; no postinstall script |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Vue SPA (Phase 5+)                 board /ws + /api/* (UNCHANGED)
   │ POST/GET /api/copilotkit/* (SSE)
   ▼
┌───────────────────────────────────────────────────────────────┐
│ Bun.serve fetch → /api/copilotkit/* → srv.timeout(req,0)      │
│   → createCopilotRuntimeHandler (multi-route, index.ts:348-351)│
│   CopilotRuntime({ agents:{default: RailyinAgent},            │
│                   runner: RailyinAgentRunner })   ← D-12 swap │
│   ┌──────────────────────────────────────────────────────┐    │
│   │ handleRun: cloneAgentForRequest → agent.clone()      │    │
│   │   → setMessages/setState/threadId → runner.run()     │    │
│   │ handleConnect: → runner.connect({threadId})          │    │
│   │ handleStop: → runner.stop({threadId})                │    │
│   └──────────────┬──────────────────────────┬────────────┘    │
│                  ▼                          ▼                  │
│   RailyinAgentRunner (extends InMemoryAgentRunner)            │
│    run(): super.run().pipe(tap(→ jsonl-store.append))         │
│    connect(): store hit? super.connect : file? replay : ∅     │
│    (lock "Thread already running" inherited)                  │
│                  │ agent.runAgent(input, {onEvent})           │
│                  ▼                                            │
│   RailyinAgent.run(input) → Observable<BaseEvent>             │
│    runAgentInput→chat-turn mapping → executeChatTurn(...)     │
│    onEngineEvent/onRunEnd callbacks → event-bridge → events   │
│                  │                                            │
│                  ▼                                            │
│   Orchestrator → ChatExecutor → StreamProcessor.consume()     │
│   ─ existing path, ONE optional callback added ─              │
│   → engine.execute() → AsyncIterable<EngineEvent>             │
│   (registry.resolveEngineForModel: 5 engines, config-driven)  │
└───────────────────────────────────────────────────────────────┘
   data/threads/{conversation.id}.jsonl   ← append-only event log
```

### Recommended Project Structure

```
src/bun/
├── copilotkit/                 # NEW (D-11) — everything AG-UI, ~800-1000 LOC
│   ├── railyin-agent.ts        # AbstractAgent subclass: RunAgentInput → executeChatTurn → events
│   ├── event-bridge.ts         # pure EngineEvent → BaseEvent translation (no I/O)
│   ├── railyin-runner.ts       # InMemoryAgentRunner subclass: JSONL persist/replay, empty connect
│   ├── jsonl-store.ts          # append/read data/threads/{id}.jsonl (+ threadId sanitization)
│   └── *.test.ts               # co-located vitest unit tests (src/bun/test/ convention)
├── engine/                     # EXISTING — one optional callback param added to StreamProcessor.consume
│   └── stream/stream-processor.ts
└── index.ts                    # D-12: register RailyinAgent + RailyinAgentRunner; probe gate stays
e2e/api/copilotkit/             # extend: real-server tests against RailyinAgent + mock engine
```

### Pattern 1: Runner subclass as persistence seam (locked D-04, verified mechanics)

**What:** Extend `InMemoryAgentRunner`; override `run()` (persist via pipe-tap, then `super.run`) and `connect()` (JSONL re-hydrate for cold threads, else `super.connect`).
**When to use:** Any custom backend with its own durable store (this IS the documented AWS AgentCoreRunner pattern).

Key verified mechanics (from installed in-memory.mjs):
- `run()` throws `"Thread already running"` synchronously BEFORE returning the observable when the thread is running (`store.isRunning || store.stopRequested`), unless `onConcurrentRun: "supersede"` — pass no options to keep the throw.
- The returned observable is `runSubject.asObservable()` — a `ReplaySubject(Infinity)` fed by `agent.runAgent(request.input, {onEvent, onNewMessage, onRunStartedEvent})` AFTER the RUN_STARTED input-patch (lines 372-398). **Piping it through a `tap` persists exactly what the client receives.**
- `connect()`: in-memory store present → `compactEvents(allHistoricEvents)` + live-tail with messageId dedup; store absent → `connectionSubject.complete()` (empty, 200) — this is the Phase 1-verified never-run contract.

**Example (skeleton — see Code Examples for the verified contract):**
```typescript
// Source: verified against node_modules/@copilotkit/runtime/dist/v2/runtime/runner/in-memory.mjs:297-432
export class RailyinAgentRunner extends InMemoryAgentRunner {
  constructor(private readonly store: JsonlStore) { super(); /* onConcurrentRun stays "throw" */ }

  override run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return super.run(request).pipe(tap({
      next: (event) => void this.store.append(request.threadId, event), // append-only, per event
      complete: () => this.store.endRun(request.threadId),
    }));
  }

  override connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    // Hot path (thread known to this process): base machinery (compacted history + live tail).
    // Cold path (fresh process, file exists): replay the JSONL log (RUNR-05, #3553 fix).
    // Never-run (no file): complete empty (RUNR-06, Phase 1-verified zero-frame contract).
  }
}
```

### Pattern 2: Custom AbstractAgent as the execution bridge (locked D-01)

**What:** `RailyinAgent extends AbstractAgent`; implements the abstract `run(input)` returning `Observable<BaseEvent>`; `abortRun()` routes to `orchestrator.cancel(executionId)`; **overrides `clone()`** to preserve injected deps.

**Verified contract (must mirror — see Code Examples):**
- The runtime clones the registered agent per request (`cloneAgentForRequest` → `agents[agentId].clone()`, agent-utils.mjs) then sets `agent.setMessages(input.messages); agent.setState(input.state); agent.threadId = input.threadId` (handle-run.mjs) before `runner.run()`.
- Default `AbstractAgent.clone()` copies ONLY `agentId, description, threadId, messages, state, _debug, _debugLogger, isRunning, subscribers, middlewares, pendingInterrupts` (minified index.mjs `clone()` in AbstractAgent) — **constructor-injected deps (orchestrator, db) are LOST unless clone() is overridden** (e.g. `clone() { const c = super.clone(); c.orchestrator = this.orchestrator; ...; return c; }`).
- The runner drives the agent through `agent.runAgent(request.input, {onEvent})` — the built-in wrapper that runs middlewares, `transformChunks`, `verifyEvents`, `apply` and awaits the run; the agent's own `run()` must emit `RUN_STARTED` FIRST (verifyEvents rejects otherwise) and a terminal event itself (`RUN_FINISHED`/`RUN_ERROR`) — otherwise `finalizeRunEvents` appends `RUN_ERROR {code:"INCOMPLETE_STREAM", message:"Run ended without emitting a terminal event"}`.
- `abortRun()` is a no-op in the base class — override it.

**How the agent starts execution (the seam this research recommends):** add an optional callback pair to the existing surface — `ExecutionCoordinator.executeChatTurn(..., opts?: { onEngineEvent?: (event: EngineEvent) => void; onRunEnd?: (outcome: "done" | "error" | "aborted" | "decision") => void })` — threaded through `Orchestrator` → `ChatExecutor.execute` → `StreamProcessor.runNonNative/consume`. The callback fires at the top of `consume()`'s `for await` loop (stream-processor.ts:184), i.e. for EVERY raw engine event with exact ordering; `onRunEnd` fires at the four terminal points of consume() (done case ~line 415, fatal error ~446, abort paths ~184-202/531-547, decision_request pause ~484). When no callback is passed, behavior is byte-identical to today. The agent feeds these into a per-run `ReplaySubject`, translates via `event-bridge.ts`, and appends the terminal AG-UI event on `onRunEnd`.

Rationale: `executeChatTurn` returns `Promise<{message, executionId}>` — the raw `AsyncIterable<EngineEvent>` is consumed inside `StreamProcessor.consume()` (runNonNative is fire-and-forget). A new stream-returning coordinator method would require duplicating consume()'s DB status writes; the callback keeps them (dual-write → rollback-safe per IMPR-03) and keeps ordering identical to the legacy path.

### Pattern 3: JSONL store behind a small module (locked D-05)

**What:** `jsonl-store.ts` — pure-ish module, no constructor-visible deps (inject the directory path or `getDataDir()` at construction from the composition root). API: `append(threadId, event)`, `read(threadId): BaseEvent[] | null`, `exists(threadId)`, `endRun(threadId)`.
- **Location:** `join(getDataDir(), "threads", `${threadId}.jsonl`)` — `getDataDir()` = `RAILYN_DATA_DIR ?? join(homedir(), ".railyn")` [VERIFIED: src/bun/utils/platform.ts:16-17]. The e2e fixture already sets `RAILYN_DATA_DIR` when `mcpConfig` is passed (server.ts:142-147) — reuse that seam for JSONL e2e isolation.
- **Line schema (recommendation):** one `BaseEvent` JSON object per line, verbatim (`JSON.stringify(event)`), first line = the run's `RUN_STARTED` (with `input.messages` = the user turn). No envelope in v1; Phase 4 may add `{v, seq, id}` for crash tolerance/dedup cursors (PITFALLS 8.4).
- **Tolerant read:** skip + log a partial trailing line instead of failing the file (Phase 4 hardens).
- **Sanitization (MUST):** reject threadIds not matching `^\d+$` (threadId = `String(conversation.id)`; `conversations.id` is INTEGER AUTOINCREMENT [VERIFIED: migrations/001_initial.ts:39-41]) before any filesystem use; containment-check the final path. Security section below.

### Pattern 4: Replay with completed tool calls (D-09 / RUNR-07)

**What:** two complementary synthesis points:
1. **At run end (bridge):** when the run terminates and any `TOOL_CALL_START` lacks `TOOL_CALL_RESULT` (engines that batch results), the bridge emits synthetic `TOOL_CALL_END` + `TOOL_CALL_RESULT {messageId, toolCallId, content:""}` BEFORE `RUN_FINISHED` — the persisted log then never contains dangling tool calls.
2. **At replay (runner):** safety pass for any file that predates (1) or was crash-truncated: `finalizeRunEvents(events)` (from `@copilotkit/shared`) completes open TEXT_MESSAGE/TOOL_CALL and appends a terminal if missing [VERIFIED: finalize-events.mjs] — BUT note it returns early when a terminal exists, so for the bridge case use a small local `completeOpenToolCalls(events)` before `compactEvents`.

**Replay order (recommendation):** `completeOpenToolCalls` → `compactEvents` (from `@ag-ui/client`; merges per-message CONTENT deltas, keeps run boundaries [VERIFIED: minified compactEvents]) → emit verbatim. This mirrors the base in-memory connect() shape (compacted historic events with per-run RUN_STARTED/RUN_FINISHED boundaries), which is the shape the pinned client already handles on connect.

### Anti-Patterns to Avoid
- **Reimplementing the runner from scratch:** extend `AgentRunner` abstract directly → you re-derive ReplaySubject wiring, compaction, dedup, the concurrency guard. Always extend `InMemoryAgentRunner` and call `super`.
- **Storing per-thread state on the agent instance:** the runtime clones per request; per-thread cursors/AbortControllers must live in the per-run closure (or a threadId-keyed registry owned by the composition root). The clone only carries the fixed field list — anything else must be re-injected in `clone()`.
- **Persisting the JSONL from inside `agent.run()` (pre-runner events):** the runner patches `RUN_STARTED.input` (filters historic message ids) AFTER the agent emits — persist from the runner's observable (`super.run().pipe(tap(...))`) so the log matches the wire.
- **Emitting `MESSAGES_SNAPSHOT` mid-stream or from stale caches:** edit-based merge deletes client messages (PITFALLS Pitfall 3). Replay the event log; snapshot only if Phase 4 import needs it.
- **Double-broadcasting chat events over /ws:** the AG-UI path is the ONLY chat path; `task_updated`/`new_message` EngineEvents stay on the existing /ws path (board events) — the bridge ignores them.
- **Depending on a typed lock error code from SSE:** verified — a concurrent run gives HTTP 200 + empty body, not 500/409. The busy guard is client-side (Phase 5); the runner throw is the server contract.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Runner lifecycle (concurrency guard, compaction, live-tail, dedup) | Full `AgentRunner` implementation | `InMemoryAgentRunner` subclass (`super.run`/`super.connect`) | ReSubject wiring + `compactEvents` + `finalizeRunEvents` are subtle; the base already implements them |
| Event lifecycle completion (open messages/tool calls, missing terminal) | Hand-rolled terminal synthesis | `finalizeRunEvents` from `@copilotkit/shared` (+ small local `completeOpenToolCalls`) | Verified implementation handles TEXT_MESSAGE_END/TOOL_CALL_END/TOOL_CALL_RESULT + RUN_FINISHED/RUN_ERROR + stop semantics |
| Event compaction | Custom dedup | `compactEvents` from `@ag-ui/client` | Verified: merges CONTENT deltas per messageId, collapses state, keeps run boundaries |
| RunAgentInput / event validation | Hand-parsed JSON | `RunAgentInputSchema` + `EventSchemas` from `@ag-ui/core` (server: `parseRunRequest` already 400s invalid bodies) | zod schemas are the wire contract; tests should parse bridge output with `EventSchemas` |
| SSE framing | Manual `data:` encoding | Runtime's `EventEncoder` (already in use) | Tests only assert the frame shape (`parseSseFrames`, copilotkit.test.ts:38-43) |
| Engine execution/prompt assembly | Direct `engine.execute()` from the agent | Existing `ChatExecutor`/`ExecutionCoordinator` | Loses cross-engine context, slash commands, stage instructions, DB state |
| File writes | Third-party JSONL lib | Bun/node built-ins (`Bun.write`/`appendFile`) | Trivial append-only; no package needed (Phase 4 may reuse the existing `WriteBuffer`) |

**Key insight:** the risky bespoke code in this phase is ONLY the translation table (`event-bridge.ts`) and the persistence glue (`jsonl-store.ts` + runner overrides). Everything lifecycle-shaped already exists in the installed stack — extending beats reimplementing.

## Common Pitfalls

### Pitfall 1: Losing injected dependencies in `AbstractAgent.clone()`
**What goes wrong:** the runtime clones the registered agent per request (`cloneAgentForRequest`); the default `clone()` copies only a fixed field list, so `RailyinAgent`'s orchestrator/DB references are `undefined` on the clone → runtime crashes or silent no-op on first run.
**Why it happens:** `clone()` is `Object.create(Object.getPrototypeOf(this))` + explicit field copies (verified in the installed client source); class fields assigned in the constructor are own-properties and are NOT copied.
**How to avoid:** override `clone()` to re-attach injected deps after `super.clone()`. Unit test: `clone().orchestrator === original.orchestrator`.

### Pitfall 2: The "Thread already running" 500 (claim correction)
**What goes wrong:** prior research (PITFALLS.md) claims the lock "surfaces as a generic HTTP 500". **Verified against installed 1.66.4: it does NOT.** `handleSseRun` → `createSseEventResponse` invokes `observableFactory` (which calls `runner.run()`) inside an async IIFE whose `.catch` closes the stream — the synchronous throw from `run()` yields **HTTP 200 with an empty SSE body** (sse-response.mjs:11-20, 101-108).
**How to avoid:** assert the lock at the runner unit level (`expect(() => runner.run(...)).toThrow("Thread already running")`), and at the API level assert "second run yields zero frames" — do NOT assert a 500 status. Client busy-guard is the UX protection (Phase 5).

### Pitfall 3: Agent stream ends without a terminal event
**What goes wrong:** `finalizeRunEvents` appends `RUN_ERROR {code:"INCOMPLETE_STREAM", message:"Run ended without emitting a terminal event"}` when the agent's stream completes without RUN_FINISHED/RUN_ERROR — every normal run becomes an error run; worse, a later RUN_STARTED after that RUN_ERROR is rejected by `verifyEvents` ("The run has already errored with 'RUN_ERROR'. No further events can be sent." — verified in the installed client source).
**Why it happens:** the base runner does NOT synthesize RUN_FINISHED (probe comment, probe-agent.ts:14-17).
**How to avoid:** the bridge always emits a terminal: `done` → `RUN_FINISHED {threadId, runId, result:null}`; fatal `error` → `RUN_ERROR {message, code}`; abort/stream-end → `RUN_FINISHED` (stopped). Unit-test every terminal path.

### Pitfall 4: Multi-run replay with an errored run poisons the stream
**What goes wrong:** `verifyEvents` permanently rejects any event after `RUN_ERROR`. A JSONL containing `RUN_ERROR` followed by another run's `RUN_STARTED` breaks client hydration on replay (issue #4943 pattern).
**How to avoid:** replay in per-run boundary order (allowed: RUN_STARTED after RUN_FINISHED — verified reset logic); if the log's LAST run is mid-flight (no terminal), complete it with `finalizeRunEvents`. If an errored run is followed by later runs, test the exact pinned-client behavior (STATE.md blocker) — the safe fallback is truncating the replay at the first `RUN_ERROR`. Add the replay-shape unit tests (PITFALLS Pitfall 2 checklist: missing file / 0-run file / N completed runs / interrupted run / errored-run-then-run).

### Pitfall 5: `TOOL_CALL_RESULT.messageId` is required
**What goes wrong:** the event zod schema requires `messageId: z.ZodString` on `TOOL_CALL_RESULT` (verified index.d.ts:4434-4461). Emitting it without messageId fails schema validation client-side (400/parse failure).
**How to avoid:** the bridge generates `messageId` (e.g. `${toolCallId}-result`, matching finalizeRunEvents' own convention) for every tool result.

### Pitfall 6: Duplicate/interleaved toolCallIds break replay and rendering
**What goes wrong:** child/subagent tool calls can reuse ids (`call_0` repeatedly — the stream-processor already fights this with `childToolSeq`, stream-processor.ts:156-165); duplicate toolCallId on replay pushes duplicate keys client-side (issue #3928); interleaved tool calls duplicate assistant messages (issue #3644).
**How to avoid:** the bridge namespaces toolCallIds (e.g. `${parentCallId}::${callId}` or a per-run monotonic counter) so ids are unique within a thread; keep TOOL_CALL_START..RESULT for the same call contiguous where possible. Regression test: replay a thread with interleaved tool calls → exactly one assistant message, no in-progress tools.

### Pitfall 7: JSONL append vs crash tolerance
**What goes wrong:** a crash mid-append leaves a partial trailing line; strict parsing then fails the whole thread (PITFALLS Pitfall 8).
**How to avoid:** append per event (never run-end batch — replay needs the mid-run tail for reconnect), tolerant reader (skip + log partial trailing line). Full crash tolerance (buffered writer, atomic index, event ids) is deferred to Phase 4 by CONTEXT.md — Phase 2 only needs "basic append works".

### Pitfall 8: Path traversal via threadId
**What goes wrong:** a crafted threadId (`../../etc/passwd`) interpolated into `data/threads/{threadId}.jsonl` reads/writes outside the threads dir; the runtime accepts client-supplied threadIds.
**How to avoid:** validate `^\d+$` (conversation ids are INTEGER) before any filesystem use + containment check on the resolved path; unit-test traversal attempts. See Security Domain.

### Pitfall 9: The probe gate must stay green
**What goes wrong:** D-12 replaces the ScriptedAgent registration; Phase 1 tests (`copilotkit.test.ts`, `sse-text-diff.test.ts`) spawn with `copilotkitProbe: true` and must keep passing.
**How to avoid:** keep `RAILYN_COPILOTKIT_PROBE=1` → ScriptedAgent; register RailyinAgent+Runner in the default (non-probe) path. The probe gate must be checked BEFORE the real registration so the dynamic-imported probe never loads in prod.

## Code Examples

### AbstractAgent (the class to extend) — verified this session
Source: `node_modules/@ag-ui/client/dist/index.d.ts:483-540` (verbatim excerpt):
```typescript
declare abstract class AbstractAgent {
  agentId?: string;
  description: string;
  threadId: string;
  messages: Message[];
  state: State;
  subscribers: AgentSubscriber[];
  isRunning: boolean;
  pendingInterrupts: Interrupt[];
  constructor({ agentId, description, threadId, initialMessages, initialState, debug }?: AgentConfig);
  subscribe(subscriber: AgentSubscriber): { unsubscribe: () => void };
  abstract run(input: RunAgentInput): Observable<BaseEvent>;
  getCapabilities?(): Promise<AgentCapabilities>;
  runAgent(parameters?: RunAgentParameters, subscriber?: AgentSubscriber): Promise<RunAgentResult>;
  connectAgent(parameters?: RunAgentParameters, subscriber?: AgentSubscriber): Promise<RunAgentResult>;
  abortRun(): void;
  clone(): any;
  addMessage(message: Message): void;
  addMessages(messages: Message[]): void;
  setMessages(messages: Message[]): void;
  setState(state: State): void;
}
```
Note the abstract method is `run`, and the base `abortRun()`/`clone()` implementations are the ones that must be overridden.

### RunAgentInput — verified this session
Source: `node_modules/@ag-ui/core/dist/index.d.ts:2305-3257` (field summary, verbatim):
```typescript
// RunAgentInputSchema: { threadId: z.ZodString; runId: z.ZodString; parentRunId?: z.ZodOptional<z.ZodString>;
//   state: z.ZodAny; messages: z.ZodArray<Message>; tools: {name,description,metadata?,parameters?}[]; 
//   context: {value,description}[]; forwardedProps?: z.ZodOptional<z.ZodAny>;
//   resume?: { status: "resolved"|"cancelled"; interruptId: string; payload?: any }[] }
```

### The runner contract — verified this session
Source: `node_modules/@copilotkit/runtime/dist/v2/runtime/runner/in-memory.mjs:297-432` (verbatim excerpts):
```javascript
run(request) {
  const store = sharedStore.getOrCreate(request.threadId);
  if (store.isRunning || store.stopRequested) {
    if (this.onConcurrentRun !== "supersede") throw new Error("Thread already running");
    ...
  }
  ...
  const runAgent = async () => {
    ...
    await request.agent.runAgent(request.input, {
      onEvent: ({ event }) => {
        let processedEvent = event;
        if (event.type === EventType.RUN_STARTED) {
          const runStartedEvent = event;
          if (!runStartedEvent.input) { /* patch input: {...request.input, messages: filtered} */ }
        }
        runSubject.next(processedEvent);
        nextSubject.next(processedEvent);
        currentRunEvents.push(processedEvent);
      },
      ...
    });
    finalizeRun({});
  };
  runAgent();
  return runSubject.asObservable();
}
connect(request) {
  const store = sharedStore.get(request.threadId, { touch: true });
  const connectionSubject = new ReplaySubject(Infinity);
  if (!store) { connectionSubject.complete(); return connectionSubject.asObservable(); }
  const compactedEvents = compactEvents(/* all historic run events */);
  // replay compactedEvents, then live-tail from store.subject with messageId dedup, else complete
}
```

### Phase 1 probe agent (the shape RailyinAgent mirrors) — verified this session
Source: `e2e/api/copilotkit/probe-agent.ts:51-83`:
```typescript
export class ScriptedAgent extends AbstractAgent {
  constructor() { super({ agentId: "default", description: "Spike probe agent" }); }
  run(input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    return from(this.generateEvents(input)) as unknown as ReturnType<AbstractAgent["run"]>;
  }
  private async *generateEvents(input: RunAgentInput): AsyncGenerator<AGUIEvent> {
    const { threadId, runId } = input;
    yield { type: EventType.RUN_STARTED, threadId, runId };
    yield { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" };
    yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "hello" };
    yield { type: EventType.TEXT_MESSAGE_END, messageId: "m1" };
    yield { type: EventType.RUN_FINISHED, threadId, runId, result: null };
  }
}
```

### Event schemas the bridge must produce — verified this session
Source: `node_modules/@ag-ui/core/dist/index.d.ts` (verbatim field sets):
- `TEXT_MESSAGE_START { messageId: string; role: "developer"|"system"|"assistant"|"user" (default); name? }` (4205-4229)
- `TEXT_MESSAGE_CONTENT { messageId: string; delta: string }` (4230-4251); `TEXT_MESSAGE_END { messageId: string }` (4252-4270)
- `TOOL_CALL_START { toolCallId: string; toolCallName: string; parentMessageId? }` (4368-4392); `TOOL_CALL_ARGS { toolCallId: string; delta: string }` (4393-4414); `TOOL_CALL_END { toolCallId: string }` (4415-4433); `TOOL_CALL_RESULT { messageId: string; toolCallId: string; content: string; role?: "tool" }` (4434-4461)
- `REASONING_MESSAGE_START { messageId: string; role: "reasoning" }` (9971-9992); `REASONING_MESSAGE_CONTENT { messageId: string; delta: string }` (9993-10014); `REASONING_MESSAGE_END { messageId: string }` (10015-10033)
- `RUN_STARTED { threadId: string; runId: string; parentRunId?; input?: RunAgentInput }` (6623-6631); `RUN_FINISHED { threadId: string; runId: string; result?; outcome?: {type:"success"} | {type:"interrupt", interrupts:[{id, reason, message?, toolCallId?, responseSchema?, expiresAt?, metadata?}]} }` (9620-9694); `RUN_ERROR { message: string; code?: string }` (9891-9912)
- `EventType` enum members (verbatim, 4142-4191): `TEXT_MESSAGE_START = "TEXT_MESSAGE_START"`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `TEXT_MESSAGE_CHUNK`, `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_CHUNK`, `TOOL_CALL_RESULT`, `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT`, `CUSTOM`, `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED`, `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_MESSAGE_CHUNK`, `REASONING_END`, `REASONING_ENCRYPTED_VALUE` (+ deprecated `THINKING_*`)

### The EngineEvent source (in-repo) — verified this session
Source: `src/bun/engine/types.ts:20-50` (verbatim, key members):
```typescript
export type EngineEvent = (
  | { type: "token"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_start"; name: string; arguments: string; callId?: string; parentCallId?: string; isInternal?: boolean; display?: ToolCallDisplay }
  | { type: "subagent_start"; callId: string; intent: string; prompt: string }
  | { type: "subagent_stop"; callId: string }
  | { type: "tool_result"; name: string; result: string; callId?: string; isError?: boolean; parentCallId?: string; isInternal?: boolean; display?: ToolCallDisplay; detailedResult?: string; contentBlocks?: ...; writtenFiles?: ... }
  | { type: "ask_user"; payload: string }
  | { type: "decision_request"; payload: string }
  | { type: "shell_approval"; command: string; executionId: number }
  | { type: "status"; message: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; contextWindow?: number }
  | { type: "task_updated"; task: Task }
  | { type: "new_message"; message: ConversationMessage }
  | { type: "compaction_start" } | { type: "compaction_done"; summary?: string }
  | { type: "done" } | { type: "error"; message: string; fatal?: boolean }
) & { isError?: boolean };
```

### The agent → executor seam (recommended minimal diff) — verified this session
Source: `src/bun/engine/stream/stream-processor.ts:184` (the `for await` loop top) and `src/bun/engine/coordinator.ts:10`:
```typescript
// coordinator.ts (additive — existing signature untouched):
executeChatTurn(sessionId: number, conversationId: number, content: string, model?: string,
  enabledMcpTools?: string[] | null, workspaceKey?: string, attachments?: Attachment[],
  engineContent?: string, opts?: { onEngineEvent?: (e: EngineEvent) => void; onRunEnd?: (o: "done"|"error"|"aborted"|"decision") => void },
): Promise<{ message: ConversationMessage; executionId: number }>;
```
Call sites for `onRunEnd` in consume(): `case "done"` (line 415), `case "error"` fatal (line 446), the two abort paths (lines 184-202 and 531-547), `case "decision_request"` (line 484 — map to "decision"; Phase 3 replaces this with the interrupt outcome).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `agent.runAgent(input, {onEvent})` as the agent API to implement (ARCHITECTURE.md/STACK.md) | `AbstractAgent`'s abstract method is `run(input): Observable<BaseEvent>`; `runAgent` is the built-in wrapper the RUNNER calls | Correct at 0.0.57 (this session) | RailyinAgent implements `run()` returning an Observable — mirror the probe; do NOT override `runAgent` |
| Concurrent run surfaces as HTTP 500 (PITFALLS.md) | HTTP 200 + empty SSE body in 1.66.4 (throw swallowed by createSseEventResponse) | Verified this session | Tests assert runner throw + zero frames, not a 500 status |
| "Base runner supplements RUN_STARTED if absent" (ARCHITECTURE.md) | The runner patches `RUN_STARTED.input` but the event itself MUST be emitted by the agent | Verified this session | Bridge always emits RUN_STARTED first; emitting WITH input avoids runner's message filtering |
| RUN_FINISHED appended by base runner (D-03) | `finalizeRunEvents` appends RUN_FINISHED only when `stopRequested`, else RUN_ERROR "INCOMPLETE_STREAM" — agent must emit the terminal itself | Verified this session (finalize-events.mjs) | D-03's "done → RUN_FINISHED (base runner appends)" needs a correction: the bridge emits it |
| `POST /agent/:id/stop` (ARCHITECTURE.md) | `POST /agent/:agentId/stop/:threadId` (threadId in path, multi-route) | Phase 1 verified (copilotkit.test.ts:92,99) | Use the path form in tests/docs |
| `GET /threads` unavailable self-hosted | Works in 1.66.4 via local `listThreads()` fallback (Phase 1 test 8) | Phase 1 verified | Phase 4 may override `listThreads()` for JSONL; not needed in Phase 2 |

**Deprecated/outdated:**
- `forwardedProps.command.resume` (legacy resume channel) — deprecated; Phase 3 uses `RunAgentInput.resume[]` (PITFALLS Pitfall 5). Do not build Phase 2 resume plumbing.
- `THINKING_*` events — deprecated in favor of `REASONING_*` (EventType enum comments, index.d.ts:4152-4171). Emit REASONING_* only (BRDG-02).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The optional `onEngineEvent`/`onRunEnd` callback threaded through `executeChatTurn` is the right seam (vs. a new stream-returning method) | Architecture Patterns | If the planner prefers the stream-return method, executor refactor scope grows (DB status duplication); both satisfy the requirements — decision is in the agent's discretion |
| A2 | The client (Phase 5) accepts compacted multi-run replays with per-run boundaries (base in-memory connect shape) on pinned `@ag-ui/client` | Pitfall 4 | STATE.md blocker (#4943): if multi-run replay trips verifyEvents, fall back to truncating replay at first RUN_ERROR or single-run wrapping — replay-shape unit tests must exist before UI work |
| A3 | `sessionId` is effectively ignored by `ChatExecutor` (verified: not referenced in execute body; status updates key on conversation_id) so the agent can pass 0 or the chat_sessions.id | Architecture Patterns | If a future executor change starts keying on sessionId, the agent must resolve chat_sessions.id by conversation_id (one query) |
| A4 | The conversation's engine/model resolution (`conversations.model` → `EngineRegistry.resolveEngineForModel`) matches what the old chat UI did | Architecture Patterns | Card conversations rely on `conversations.model` being seeded; e2e fixture seeds `default_model: copilot/mock-model` via chatSessions.create (server.ts:71-83) |
| A5 | `finalizeRunEvents` early-return-when-terminal exists means the bridge must do its own `completeOpenToolCalls` pass at run end | Pitfall 5 / Pattern 4 | If the bridge instead relies on finalizeRunEvents, dangling tool calls would persist to JSONL (only caught at replay) |
| A6 | JSONL replay of `RUN_STARTED.input.messages` is sufficient to restore the user's turns (assistant turns come from replayed events) | Pattern 4 | Matches base in-memory connect behavior; if the client (Phase 5) needs MESSAGES_SNAPSHOT for cold threads, add it to the replay tail (AgentCoreRunner pattern) — additive |

## Open Questions

1. **Multi-run replay acceptance on the pinned client (STATE.md blocker #4943).**
   - What we know: `compactEvents` keeps run boundaries; base in-memory `connect()` emits multi-run sequences (RUN_STARTED..RUN_FINISHED, RUN_STARTED..); `verifyEvents` allows RUN_STARTED after RUN_FINISHED but rejects everything after RUN_ERROR; Phase 1 only proved single-run threads over a real server.
   - What's unclear: whether the pinned client's connect path (Phase 5) applies verifyEvents to the replayed stream and rejects RUN_ERROR-then-RUN_STARTED sequences.
   - Recommendation: Phase 2 unit tests cover the replay shapes; if an errored-run-then-run log must rehydrate, truncate replay at the first RUN_ERROR (safe default) and document.

2. **Cross-path run locking (board transition vs AG-UI chat on the same conversation).**
   - What we know: the runner lock covers AG-UI runs only; board transitions run through `executeTransition` with the same conversationId; the old stack's cancel races are a known fragile area (CONCERNS.md:88-91).
   - What's unclear: whether Phase 2 must reject an AG-UI run while a transition execution is `running` on the same conversation (PITFALLS Pitfall 4).
   - Recommendation: cheap advisory check in the agent before starting — `SELECT 1 FROM executions WHERE conversation_id = ? AND status IN ('running','waiting_user')` — plus a test; full policy (queue vs reject) is a planner call within the agent's discretion.

3. **Workspace key for card conversations.**
   - What we know: `executeChatTurn` defaults to `getDefaultWorkspaceKey()`; card conversations resolve their workspace via `wsRepo.getTaskWorkspaceKey(taskId)` (orchestrator.ts:289-295 pattern); chat_sessions.workspace_key covers standalone sessions.
   - Recommendation: agent resolves workspaceKey: task-linked → task → workspace; else chat_sessions row; else default. Multi-workspace correctness is untested territory — keep the resolver small and unit-test the three branches.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Runtime + tests | ✓ | 1.4.0 | — |
| Node | dev tooling (ctx7, npx) | ✓ | v20.20.1 | — |
| `@ag-ui/client` / `@ag-ui/core` / `@copilotkit/runtime` / `@copilotkit/shared` | Bridge + runner | ✓ (installed) | 0.0.57 / 0.0.57 / 1.66.4 / 1.66.4 | — |
| rxjs (hoisted) | Observable types | ✓ | 7.8.2 (nested 7.8.1) | explicit pin recommended |
| SQLite (bun:sqlite) | thread mapping DB reads | ✓ | built-in | — |
| Playwright | not needed this phase | ✓ | — | — |
| External model APIs (pi/claude/copilot/cursor/opencode) | production runs | n/a | — | e2e uses `MockExecutionEngine` via `RAILYN_TEST_EXECUTION_ENGINE=mock` (server.ts:170) |

**Missing dependencies with no fallback:** none. **Missing dependencies with fallback:** none.

## Validation Architecture

`workflow.nyquist_validation` is `true` (config.json) — this section applies.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (bun:test runtime via `bun test`) — `src/bun/test/` convention with `helpers.ts` (initDb, setupTestConfig, makeTestRegistry, seedChatSession) |
| Config file | vitest.config.ts (aliases `@`, `@shared`; only `src/mainview/**` included — Bun tests are invoked directly by path) |
| Quick run command | `bun test src/bun/copilotkit --timeout 20000` |
| Full suite command | `bun test src/bun --timeout 20000` + `bun test e2e/api --timeout 30000` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BRDG-01/02/03 | event-bridge maps every EngineEvent family to valid AG-UI events (parse with `EventSchemas`); exactly one translation path | unit | `bun test src/bun/copilotkit/event-bridge.test.ts -x` | ❌ Wave 0 |
| RUNR-02/05/06 | jsonl-store append/read/exists + missing-file → null + traversal rejection | unit | `bun test src/bun/copilotkit/jsonl-store.test.ts -x` | ❌ Wave 0 |
| RUNR-04 | runner throws "Thread already running" on concurrent run | unit | `bun test src/bun/copilotkit/railyin-runner.test.ts -x` | ❌ Wave 0 |
| RUNR-05/07 | connect replays JSONL with synthesized TOOL_CALL_RESULT (4 replay shapes) | unit | `bun test src/bun/copilotkit/railyin-runner.test.ts -x` | ❌ Wave 0 |
| RUNR-01/03 | agent run() emits RUN_STARTED-first + mapped events + terminal; clone() preserves deps; abortRun() cancels | unit (fake coordinator) | `bun test src/bun/copilotkit/railyin-agent.test.ts -x` | ❌ Wave 0 |
| BRDG-01/02/03 | real server: run through RailyinAgent + mock engine streams correct SSE; connect replays; stop works; concurrent run → zero frames | e2e/api | `bun test e2e/api/copilotkit/railyin.test.ts -x` | ❌ Wave 0 |
| RUNR-02 | JSONL file exists at `<RAILYN_DATA_DIR>/threads/{threadId}.jsonl` after a real-server run | e2e/api | same file | ❌ Wave 0 |
| (regression) | Phase 1 probe tests + SSE text diff still green | e2e/api | `bun test e2e/api/copilotkit -x` | ✅ existing |

### Sampling Rate
- **Per task commit:** `bun test src/bun/copilotkit --timeout 20000`
- **Per wave merge:** `bun test src/bun --timeout 20000` + `bun test e2e/api --timeout 30000`
- **Phase gate:** Full suite green before `/gsd-verify-work` (AGENTS.md commands)

### Wave 0 Gaps
- [ ] `src/bun/copilotkit/event-bridge.test.ts` — pure translation contract tests (covers BRDG-01..03)
- [ ] `src/bun/copilotkit/jsonl-store.test.ts` — persistence + sanitization (covers RUNR-02, security)
- [ ] `src/bun/copilotkit/railyin-runner.test.ts` — lock, replay shapes, empty connect (covers RUNR-04..07)
- [ ] `src/bun/copilotkit/railyin-agent.test.ts` — agent lifecycle with a fake ExecutionCoordinator (covers RUNR-01/03)
- [ ] e2e/api real-server suite (`e2e/api/copilotkit/railyin.test.ts`) — wire-level proof on the mock engine
- [ ] Extend `src/bun/testing/mock-engine.ts` with scripted tool/reasoning scenarios (via forwardedProps, probe-style) so e2e covers TOOL_CALL_*/REASONING_* on the real wire
- [ ] Consider a `verifyEvents`-harness unit test (import `verifyEvents` from `@ag-ui/client`) applied to the replay stream to pre-prove Phase 5 client acceptance (A2)

## Security Domain

`workflow.security_enforcement` is `true` (config.json) — this section applies. Local-first app; no auth/session surface; the phase adds a client-triggered file-write path and reuses the unauthenticated localhost runtime surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Localhost single-user app; no auth to add |
| V3 Session Management | no | No sessions; SSE is connection-scoped |
| V4 Access Control | no | Same-origin loopback; existing posture (origin validation on /api/*, /ws) |
| V5 Input Validation | **yes** | threadId validation `^\d+$` + path containment in `jsonl-store.ts` (never interpolate unvalidated ids into file paths); RunAgentInput already zod-validated by the runtime (400 "Invalid request body", Phase 1 test 6) |
| V6 Cryptography | no | No secrets at rest; no crypto in this phase |
| V7/SSRF | no | No outbound URL fetching added |
| V8/Path traversal | **yes** | Covered under V5: validate threadId format before filesystem use; resolve + containment-check final path; unit-test `../` and absolute-path attempts (PITFALLS Security Mistakes) |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via client-supplied threadId into `data/threads/{id}.jsonl` | Tampering | `/^\d+$/` validation + resolved-path containment check + unit tests (jsonl-store) |
| Concurrent run / double execution on one thread (resource abuse) | DoS | Inherited runner lock ("Thread already running") + advisory executions-row check (Open Question 2) |
| Prompt injection via legacy/imported content | Tampering | Deferred with import (Phase 4); bridge treats engine output as data, never re-executes it |
| Agent clone losing injected deps leading to undefined-behavior | (correctness, not security) | `clone()` override + unit test |

## Sources

### Primary (HIGH confidence — verified against installed packages this session)
- `node_modules/@ag-ui/client/dist/index.d.ts` — AbstractAgent declaration (483-540), AgentSubscriber (228-272), RunAgentParameters (36-39), verifyEvents/compactEvents exports
- `node_modules/@ag-ui/client/dist/index.mjs` (minified) — AbstractAgent implementation: `runAgent` pipeline (transformChunks → verifyEvents → apply), `clone()` field list, `abortRun(){}` no-op, verifyEvents rules, compactEvents run-boundary handling, transformChunks CHUNK expansion, buildResumeArray
- `node_modules/@ag-ui/core/dist/index.d.ts` — EventType enum (4142-4191), all event schemas (4205-10055), RunAgentInputSchema (2305-3257)
- `node_modules/@copilotkit/runtime/dist/v2/runtime/runner/in-memory.mjs` — run/connect/isRunning/stop/listThreads implementations (268-537), GLOBAL_STORE, limits
- `node_modules/@copilotkit/runtime/dist/v2/runtime/runner/agent-runner.d.mts` — AgentRunner contract + request types + LocalThreadEndpointRunner
- `node_modules/@copilotkit/runtime/dist/v2/runtime/handlers/handle-run.mjs`, `handle-connect.mjs`, `handle-stop.mjs`, `shared/agent-utils.mjs`, `shared/sse-response.mjs`, `core/fetch-handler.mjs`, `core/fetch-router.mjs`, `core/runtime.d.mts` — route wiring, cloneAgentForRequest, parseRunRequest/parseConnectRequest, SSE 200-first semantics, runner option
- `node_modules/@copilotkit/shared/dist/finalize-events.mjs` — finalizeRunEvents exact behavior
- Railyin codebase this session: `src/bun/engine/types.ts`, `coordinator.ts`, `orchestrator.ts`, `chat-executor.ts`, `stream/stream-processor.ts`, `engine-registry.ts`, `index.ts`, `utils/platform.ts`, `conversation/messages.ts`, `db/migrations/001_initial.ts` + `026_chat_sessions.ts`, `src/bun/testing/mock-engine.ts`, `src/bun/test/helpers.ts`, `e2e/api/copilotkit/probe-agent.ts`, `copilotkit.test.ts`, `sse-text-diff.test.ts`, `pins.test.ts`, `e2e/api/fixtures/server.ts`, `src/bun/server/stream-processor.ts`, `package.json`

### Secondary (MEDIUM confidence — prior project research, cited)
- `.planning/research/ARCHITECTURE.md` (lines 89-116 event mapping, 122-156 runner/JSONL patterns) — mapping/pattern claims consistent with this session's verification; API-shape claims corrected in State of the Art
- `.planning/research/PITFALLS.md` (Pitfalls 1, 2, 4, 7, 8) — replay shapes, connect-before-run, lock semantics, tool-slot reconciliation (the 500-surface claim corrected)
- `.planning/research/STACK.md` — pinned versions + compatibility matrix (verified against package.json this session)
- `.planning/research/FEATURES.md` / `SUMMARY.md` — thread mapping, JSONL scope, phase deliverables
- `.planning/phases/01-copilotruntime-hosting-thread-apis-spike/01-CONTEXT.md` — Phase 1 locked decisions (D-01..D-10), esp. the empty-connect contract
- `.planning/codebase/CONCERNS.md` — cancellation races context (orchestrator cancel ordering)

### Tertiary (LOW confidence)
- None relied upon for locked decisions; community issue numbers (#3553, #3928, #3644, #4943) are cited from PITFALLS.md and remain behavior-to-verify, not behavior-assumed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package/version verified from installed node_modules + package.json this session; no new packages needed
- Architecture: HIGH — the runner/agent/runtime contracts were read from installed source; the one discretionary seam (callback vs stream-return) is flagged (A1)
- Pitfalls: HIGH for verified mechanics (clone field list, terminal-event requirement, empty-SSE lock surface); MEDIUM for client-side replay acceptance (#4943 — Phase 5 client, A2)

**Research date:** 2026-08-09
**Valid until:** 2026-08-23 (30 days — pinned versions; re-verify only if pins move)
