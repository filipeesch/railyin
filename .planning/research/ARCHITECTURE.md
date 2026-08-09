# Architecture Research

**Domain:** AG-UI agent-chat systems (CopilotKit runtime + custom agent backend, migrated into Railyin's single-process Bun server)
**Researched:** 2026-08-08
**Confidence:** MEDIUM (provider tier for context7; key claims cross-checked against official docs site + GitHub source. Version-sensitive details flagged inline.)

## Standard Architecture

### System Overview

The CopilotKit ecosystem has a fixed three-layer shape. The frontend never talks to the LLM directly; it talks to a **CopilotRuntime** HTTP endpoint, which delegates execution and persistence to an **AgentRunner**, which drives an **AbstractAgent** that owns the actual model/agent invocation. Everything on the wire is AG-UI events over SSE.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        Vue 3 SPA (Railyin mainview)                     │
│  CopilotKitProvider (runtime-url="/api/copilotkit")                     │
│  CopilotChat + slots (#interrupt, #tool-call-*, #message-*, #input)     │
│  useAgent() / useInterrupt()                                            │
│  board: rpc.ts POST /api/*  +  WS /ws  (UNCHANGED)                      │
└───────────────┬──────────────────────────────────────────────┬──────────┘
                │ POST/GET /api/copilotkit/* (SSE)             │ POST /api/*, WS /ws
                ▼                                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                Bun.serve (single process, composition root)             │
│  fetch() → if path starts /api/copilotkit → copilotApp.fetch(req)       │
│            else → existing /api/* handler chain + WS upgrade            │
│                                                                         │
│  CopilotRuntime({ agents: { default: RailyinAgent },                    │
│                  runner: RailyinAgentRunner })                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ CopilotRuntime (hono handler: createCopilotHonoHandler)         │    │
│  │  routes: GET /info, POST /agent/:id/run, /agent/:id/connect,    │    │
│  │          POST /agent/:id/stop, [GET /threads — capability-gated]│    │
│  │  cloneAgentForRequest → per-request agent clone                 │    │
│  └───────┬─────────────────────────────────────────────┬───────────┘    │
│          ▼                                             ▼                │
│  RailyinAgentRunner (extends InMemoryAgentRunner)   RailyinAgent        │
│   run/connect/isRunning/stop lifecycle,            (extends AbstractAgent)│
│   JSONL persistence, replay, listThreads           RunAgentInput→orchestrator│
│   ┌─────────────────────────────┐                 EngineEvent→AG-UI events  │
│   │ GLOBAL_STORE (in-memory)    │                 abortRun()→AbortController│
│   │ data/threads/{id}.jsonl     │                 │                      │
│   └─────────────────────────────┘                 └──────────┬───────────┘
│                                                            ▼
│   Orchestrator → EngineRegistry → 5 engines → AsyncIterable<EngineEvent>
│   (EXISTING, untouched: executors, stream-processor, conversation, MCP)
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `CopilotKitProvider` (frontend) | Wires the Vue app to the runtime URL; hosts renderers/telemetry | `@copilotkit/vue/v2`, `runtime-url="/api/copilotkit"` |
| `CopilotChat` + slots | Chat UI: message list, input, interrupts, tool calls; owns client-side message state | `@copilotkit/vue/v2`; named slots `#chat-view`, `#message-view`, `#input`, `#interrupt`, `#tool-call-<name>`, generic `#tool-call` |
| `useAgent` (frontend) | Programmatic agent handle: `agent.messages`, `agent.isRunning`, `agent.addMessage()`, `agent.runAgent()`, `agent.abortRun()`, `agent.subscribe()` | `@copilotkit/vue/v2` hook (replaces v1 `useCopilotChat`) |
| `useInterrupt` (frontend) | Publishes interrupt state into the chat; pairs with `#interrupt` slot | `@copilotkit/vue/v2`; `handler` maps event→label |
| `CopilotRuntime` (server) | HTTP surface: routes run/connect/stop/info/threads; clones agent per request; owns SSE framing | `@copilotkit/runtime/v2`, `createCopilotHonoHandler({runtime, basePath, mode})` |
| `AgentRunner` (server) | Thread lifecycle + persistence contract: `run/connect/isRunning/stop` → `Observable<BaseEvent>`; `listThreads()` in newer versions | `InMemoryAgentRunner` (base) or subclass |
| Custom agent (server) | Execution: turns `RunAgentInput` into real agent work; emits AG-UI events; supports `abortRun()` | `AbstractAgent` subclass (from `@ag-ui/client`); in Railyin: the bridge to the orchestrator |
| `AbstractAgent` alternatives | BuiltInAgent (model-backed), HttpAgent (proxies a remote AG-UI server) | all acceptable values in `agents` map — Railyin uses neither |
| Thread persistence | Durable per-thread event history | JSONL files (`data/threads/{threadId}.jsonl`) — no official JSONL runner; runner subclass is the documented extension point |
| Existing Railyin core | Orchestrator, engine registry, 5 engine adapters, conversation injectors, DB | unchanged — sits behind the custom agent |

### Runtime Request Surface (what the frontend actually hits)

| Method + Path | Body | Response | Notes |
|---------------|------|----------|-------|
| `GET /info` | — | runtime info: agents, mode, capabilities | Newer versions advertise thread-endpoint capability here (used to gate `useThreads`) |
| `POST /agent/:agentId/run` | `RunAgentInput` | SSE stream of `BaseEvent`s | The whole conversation protocol |
| `POST /agent/:agentId/connect` | `{threadId}` (via RunAgentInput) | SSE replay: historic events + live tail | Page refresh / reconnect / first load |
| `POST /agent/:agentId/stop` | `{threadId}` | success bool | Some docs show `/agent/:id/stop/:threadId` — **verify against pinned version in spike** |
| `GET /threads` | — | `{threads, nextCursor, joinCode}` | Intelligence-mode only; local fallback exists in recent versions (`runner.listThreads()`) — **capability-gated, version-sensitive** |
| `PATCH /threads/:id`, `POST /threads/:id/archive`, `DELETE /threads/:id` | metadata | — | Intelligence-mode only — **do not rely on; build own endpoint** |

`RunAgentInput = { threadId, runId, parentRunId?, state, messages, tools, context, forwardedProps }`. `forwardedProps.command` is the control channel (resume/interrupt/stop).

### AgentRunner Lifecycle (the contract Railyin implements)

- **`run({threadId, agent, input, joinCode?, persistedInputMessages?})` → `Observable<BaseEvent>`** — starts a run; must **throw "Thread already running"** on a concurrent run for the same thread (client handles via busy flag in SSE mode; `agent_thread_locked` code in Intelligence mode). InMemoryAgentRunner also supports `onConcurrentRun: "supersede"`.
- **`connect({threadId, headers?, joinCode?})` → `Observable<BaseEvent>`** — attaches to a thread: replays historic (compacted) events, then subscribes to the live tail if a run is active; dedupes by `messageId`. **Unknown thread** (never run in this process): base impl completes empty → blank UI; the documented pattern (AWS AgentCoreRunner) instead emits `RUN_STARTED` + empty `MESSAGES_SNAPSHOT` + `RUN_FINISHED` so the UI initializes cleanly.
- **`isRunning({threadId})` → `Promise<boolean>`** — store lookup.
- **`stop({threadId})` → `Promise<boolean|undefined>`** — idempotent; calls `agent.abortRun()`; never throws; returns false when not running / already stopping / no agent ref.
- **Missed-event replay** = `connect()` replaying compacted historic runs (`compactEvents()`), then attaching to the live `ReplaySubject`. Known issue #3553: base `connect()` never reaches upstream persistence on cold start — **custom runners must override `connect()` to re-hydrate from their own store** (exactly Railyin's case: JSONL on disk, fresh process).
- **`listThreads()`** (newer versions) — returns thread summaries from the store; powers a local-dev fallback for `GET /threads` when Intelligence is not configured. Railyin should override this to read the JSONL index so the sidebar works without a custom endpoint (verify availability in pinned version).

### Event Flow (EngineEvent → AG-UI)

The bridge translates Railyin's `EngineEvent` union into AG-UI `BaseEvent`s. Client-side, convenience chunk events auto-expand into full message lifecycles (`transformChunks` pipeline).

| EngineEvent (existing) | AG-UI event(s) to emit | Notes |
|------------------------|------------------------|-------|
| `token` | `TEXT_MESSAGE_CHUNK {messageId, role:"assistant", delta}` | auto-expands to START/CONTENT/END client-side; first chunk needs `messageId` |
| `reasoning` | `REASONING_MESSAGE_CHUNK {messageId, delta}` | auto lifecycle; empty delta closes; renderers via message slots |
| `tool_start` | `TOOL_CALL_START {toolCallId, toolCallName, parentMessageId?}` | |
| tool arg chunks | `TOOL_CALL_ARGS {toolCallId, delta}` | optional — toolCallId must match START |
| tool end | `TOOL_CALL_END {toolCallId}` | |
| `tool_result` | `TOOL_CALL_RESULT {messageId, toolCallId, content, role:"tool"}` | required for client reconciliation |
| `decision_request` | `CUSTOM {name:"on_interrupt", value: payload}` + pause | HITL; see interrupt flow |
| `ask_user` / `shell_approval` | REMOVED per PROJECT.md — decision_request is the only HITL | |
| `done` | `RUN_FINISHED {threadId, runId, outcome}` | base runner appends it |
| `error` | `RUN_ERROR {message, code}` | base runner appends on throw |
| `subagent_*` / `compaction_*` / `usage` / `status*` | dropped (features removed) or `CUSTOM` | compaction_summary, usage, status removed per PROJECT.md |
| `file_diff` | removed | per PROJECT.md |
| start of run | `RUN_STARTED {threadId, runId, input?}` | base runner supplements input if absent |

Replay subtlety (from AgentCoreRunner): replayed history contains assistant messages with tool calls but no `TOOL_CALL_RESULT` events; the client needs them to reconcile state → **synthesize empty `TOOL_CALL_RESULT` for every past tool call before the `MESSAGES_SNAPSHOT`** during connect-replay.

### Interrupt / Resume Flow

1. Engine emits `decision_request` → bridge emits `CUSTOM {name:"on_interrupt", value}` **and pauses** (keeps the execution alive; does NOT abort).
2. Run ends (SSE completes) with `RUN_FINISHED` (interrupted outcome). Client shows the `#interrupt` slot (`{event, result, resolve}`) — or a custom modal via `useInterrupt` + `agent.subscribe({onCustomEvent})`.
3. User resolves → `resolve(response)` → client calls `agent.runAgent({forwardedProps:{command:{resume: response}}})` → **new `POST /run`** (new runId, same threadId).
4. Bridge sees `input.forwardedProps.command.resume`, correlates to the pending execution for that thread (conversationId = threadId), delivers the response to the engine, and continues consuming the same `AsyncIterable<EngineEvent>` → more events stream to the client.

Resume is a *new run on the same thread*, not a long-lived SSE — this matches both the LangGraph integration pattern and the runner's per-run store model.

### Thread Persistence Contract

- Thread identity: `threadId` (Railyin: `conversation.id`). Messages accumulate via `MESSAGES_SNAPSHOT` on connect; runs append events.
- In-memory store (base): `GLOBAL_STORE: Map<threadId, InMemoryEventStore>` with `{subject, isRunning, currentRunId, historicRuns[], agent, runSubject, stopRequested, currentEvents}`; events compacted before being stored as historic runs.
- **No official JSONL runner.** Options: `InMemoryAgentRunner` (default), `IntelligenceAgentRunner` (Enterprise cloud), `TelemetryAgentRunner` (legacy), community `SqliteAgentRunner`. The documented extension pattern is: **subclass `InMemoryAgentRunner`, override `run()` (persist, then `super.run`) and `connect()` (re-hydrate, then `super.connect`)** — this is Railyin's exact plan and matches AWS's official `AgentCoreRunner` example.
- JSONL design: append each AG-UI event as a JSON line per run; on connect for a thread absent from `GLOBAL_STORE`, read the file → emit events + synthesized tool results + `MESSAGES_SNAPSHOT` + `RUN_FINISHED`. Thread index for the sidebar = directory listing of `data/threads/` (+ optional `{threadId}.meta.json` for name/createdAt).
- `useThreads` (client) **requires Intelligence mode** — on self-hosted runtimes it only activates when the runtime advertises compatible REST thread endpoints; without them it errors "thread endpoints unavailable". **Two viable paths:** (a) rely on the runner `listThreads()` local fallback powering `GET /threads` (recent versions; capability-gated — verify), or (b) build a small own endpoint (`/api/copilotkit-threads` or `/api/threads`) since Railyin owns the files. PROJECT.md already planned (b) as fallback; plan for (b), opportunistically use (a).

## Recommended Project Structure

```
src/
├── bun/
│   ├── index.ts                  # composition root: mount copilotApp in Bun.serve fetch
│   ├── copilotkit/               # NEW — everything AG-UI/CopilotKit, ~800-1000 LOC
│   │   ├── runtime.ts            # new CopilotRuntime({agents, runner}) + createCopilotHonoHandler
│   │   ├── railyin-agent.ts      # AbstractAgent subclass: RunAgentInput → orchestrator → EngineEvent → BaseEvent
│   │   ├── event-bridge.ts       # pure EngineEvent → BaseEvent translation (unit-testable, no I/O)
│   │   ├── railyin-runner.ts     # InMemoryAgentRunner subclass: JSONL persist/replay, listThreads, unknown-thread connect
│   │   ├── jsonl-store.ts        # append/read data/threads/{id}.jsonl + index; buffered writer
│   │   └── import.ts             # legacy conversation_messages/stream_events → JSONL
│   ├── engine/                   # EXISTING — untouched (orchestrator, engines, stream-processor)
│   └── handlers/                 # EXISTING + maybe threads.ts (own thread-index endpoint fallback)
├── mainview/
│   ├── components/chat/          # NEW thin wrapper components around CopilotChat (pin-version isolation)
│   │   ├── RailyinChat.vue       # CopilotChat + slots
│   │   ├── DecisionInterrupt.vue # #interrupt slot → ported decision renderer
│   │   └── tool-call-renderers/  # #tool-call-* ported renderers (shell/file/delegate)
│   └── stores/                   # conversation.ts/chat.ts DELETED at frontend-swap; board stores unchanged
├── shared/                       # rpc-types.ts keeps board types; StreamEvent/stream-tree removed at cleanup
└── e2e/
    ├── ui/fixtures/mock-api.ts   # rework: mock /api/copilotkit/* + /ws board mocks
    └── api/fixtures/server.ts    # real Bun server (now also exercises copilotkit routes)
```

### Structure Rationale

- **`src/bun/copilotkit/` as one new directory:** the whole migration is additive until the frontend swap; one directory keeps the ~800–1000 new lines reviewable, delete-able (rollback), and testable in isolation. `event-bridge.ts` and `jsonl-store.ts` are pure-ish modules with no constructor-visible deps → easy vitest coverage.
- **Bridge lives in the custom agent, not the runner:** matches ecosystem semantics (agent = execution, runner = lifecycle/persistence). The base runner's `run()` already wires `agent.runAgent(input, {onEvent})` → live `ReplaySubject` → `connect()` tail-subscription; hijacking `run()` to drive the orchestrator directly would forfeit that machinery and force reimplementing compaction/replay/dedup.
- **Thin local chat components:** CopilotKit Vue v2 is early-access; wrapping `CopilotChat` in `RailyinChat.vue` keeps pinned-version upgrades to one file.
- **JSONL store behind a small class:** buffered writes for hot streams, atomic-ish append, and an index scan for the sidebar — mirrors the existing `WriteBuffer` pattern.

## Architectural Patterns

### Pattern 1: Runner subclass as persistence seam (documented extension pattern)

**What:** Extend `InMemoryAgentRunner`, override `run()`/`connect()`/`listThreads()` to layer durable storage, delegating to `super` for the rest.
**When to use:** Any custom backend with its own history store (Redis, SQLite, files) — this is the pattern CopilotKit documents and ships (AWS AgentCoreRunner).
**Trade-offs:** You inherit store semantics (concurrent-run guard, compaction, live replay) but `connect()`'s default never touches external storage — you must override it. Replay must synthesize `TOOL_CALL_RESULT`s for old tool calls.

**Example:**
```typescript
export class RailyinRunner extends InMemoryAgentRunner {
  constructor(private store: JsonlThreadStore) { super({ onConcurrentRun: "throw" }); }

  override run(request: Parameters<InMemoryAgentRunner["run"]>[0]) {
    this.store.appendUserMessage(request.threadId, request.input); // persist input first
    return super.run(request); // drives request.agent.runAgent(); record via onEvent in agent
  }

  override connect(request: Parameters<InMemoryAgentRunner["connect"]>[0]) {
    const inMemory = (await super.isRunning(request)) || this.hasStoreEntry(request.threadId);
    if (!inMemory) {
      const events = this.store.replay(request.threadId); // JSONL → events + synthesized TOOL_CALL_RESULTs
      return of<BaseEvent>(
        { type: EventType.RUN_STARTED, threadId: request.threadId, runId: randomUUID() },
        ...events,
        { type: EventType.MESSAGES_SNAPSHOT, messages: this.store.toMessages(request.threadId) },
        { type: EventType.RUN_FINISHED, threadId: request.threadId, runId: randomUUID() },
      );
    }
    return super.connect(request);
  }

  override listThreads() { return this.store.index(); } // powers local GET /threads fallback
}
```

### Pattern 2: Custom AbstractAgent as the execution bridge

**What:** An `AbstractAgent` whose `runAgent(input, {onEvent})` calls the existing orchestrator, consumes `AsyncIterable<EngineEvent>`, translates each to AG-UI events via a pure bridge, and calls `onEvent({event})`. `abortRun()` aborts the underlying `AbortController`.
**When to use:** Reusing an existing execution engine behind AG-UI instead of BuiltInAgent (model) or HttpAgent (remote server). `AbstractAgent` is the stable client-side contract (`@ag-ui/client`); the runtime clones it per request.
**Trade-offs:** The agent must be effectively stateless per request (per-request clone); all per-thread state lives in the runner. Interrupt/resume correlation (pending execution per thread) must be keyed by threadId in a small registry.

**Example:**
```typescript
export class RailyinAgent extends AbstractAgent {
  constructor(private orchestrator: ExecutionCoordinator) { super(); }
  async runAgent(input: RunAgentInput, { onEvent }: RunAgentCallback) {
    const events = this.orchestrator.executeTurn({
      conversationId: input.threadId,           // universal routing key
      userMessage: input.messages.at(-1),
      command: input.forwardedProps?.command,   // resume payload for interrupts
      signal: this.signal,                      // abortRun() aborts this
    });
    for await (const e of events) onEvent({ event: toBaseEvent(e, input.threadId, input.runId) });
  }
  abortRun() { this.signal.abort(); }
}
```

### Pattern 3: Busy-flag / thread-locked concurrency guard

**What:** `run()` throws when the thread is already running; the client guards double-submit with a local busy flag (`agent.isRunning` + submit guard), and can map the error code to a message.
**When to use:** Always in SSE mode (no typed `agent_thread_locked` code). Railyin has existing per-execution cancellation (`orchestrator.cancel`) — `stop()` must route to it, and a second run on a running thread should be rejected, not superseded, until interrupts are in place.

### Pattern 4: Interrupt slot + forwardedProps resume (HITL)

**What:** `CUSTOM on_interrupt` → `#interrupt` slot (or `useInterrupt`) → `resolve(response)` → `agent.runAgent({forwardedProps:{command:{resume}}})` → new run continues the paused execution.
**When to use:** The only sanctioned human-in-the-loop channel in this stack — matches Railyin's "decision_request is the only HITL" decision.

## Data Flow

### Message Send (run)

```
CopilotChatInput @submit-message
  → agent.addMessage({role:"user", content}) ; agent.runAgent()
  → POST /api/copilotkit/agent/default/run   (RunAgentInput{threadId=conversation.id, ...})
  → CopilotRuntime → cloneAgentForRequest("default") → runner.run({threadId, agent, input})
  → RailyinRunner.run: JSONL append(user msg) → super.run
  → RailyinAgent.runAgent(input, {onEvent})
  → orchestrator.executeTurn(conversationId=threadId, command=forwardedProps.command)
  → executors → engine.execute() → AsyncIterable<EngineEvent>
  → event-bridge: EngineEvent → BaseEvent (TEXT_MESSAGE_CHUNK / TOOL_CALL_* / REASONING_MESSAGE_CHUNK / CUSTOM)
  → onEvent({event}) → runner: runSubject.next → SSE stream to client
  → base runner appends RUN_FINISHED → SSE completes
  → client transformChunks expands chunks → CopilotChat renders; tool renderers via #tool-call-*
```

### Reconnect / First Load (connect)

```
Page load / refresh → CopilotChat → POST /agent/default/connect {threadId}
  → runner.connect(threadId)
  → GLOBAL_STORE hit? → replay compacted historic + live tail (dedup) 
  → store miss? → JSONL: synthesize tool results, emit RUN_STARTED + events + MESSAGES_SNAPSHOT + RUN_FINISHED
  → SSE → client message state restored (NO board /ws involvement)
```

### Stop

```
Stop button (#input slot onStop) → agent.abortRun() 
  → POST /agent/default/stop {threadId} → runner.stop() → agent.abortRun()
  → AbortController.abort() → engine emits fatal error/ends → RUN_FINISHED(outcome) → SSE closes
```

### Decision Request (interrupt / resume)

```
engine emits decision_request → bridge emits CUSTOM{name:"on_interrupt", value} → SSE ends (run paused, execution kept alive)
  → #interrupt slot / useInterrupt renders decision UI (event.value)
  → user resolves → resolve(response)
  → agent.runAgent({forwardedProps:{command:{resume: response}}}) → NEW POST /run (new runId, same threadId)
  → runner.run → agent sees command.resume → orchestrator continues the SAME execution
  → more EngineEvents → more AG-UI events → SSE → board may also get task.updated over /ws
```

### Thread Sidebar

```
Frontend mounts → own endpoint (or local GET /threads fallback if advertised) 
  → runner.listThreads() → JSONL index (threadId, name, updatedAt, lastRunAt) 
  → sidebar renders; click → CopilotChat switches threadId → connect() loads history
```

## Build Order (spike → bridge → interrupts → frontend swap → cleanup)

Dependency logic: the runtime mount is the enabling layer (everything else rides on it); the bridge+runner are the risky bespoke code (de-risk first with a spike); interrupts depend on the bridge working; the frontend swap is the big-bang that must wait until the wire protocol is proven; cleanup is last because rollback depends on old code surviving until swap is verified.

| # | Step | What | Depends on | Exit criteria |
|---|------|------|------------|---------------|
| 1 | **Spike** | Pin exact versions (`@copilotkit/vue`, `@copilotkit/runtime`, `@ag-ui/core`); mount `createCopilotHonoHandler` inside `Bun.serve` fetch (route `/api/copilotkit/*`); register a throwaway `BuiltInAgent`; verify `/info`, `/run`, `/connect`, `/stop` over SSE from a scratch page; check whether pinned runtime advertises thread endpoints / supports `listThreads()` | — | Single server serves both surfaces; versions pinned; thread-endpoint capability known |
| 2 | **Bridge** | `event-bridge.ts` (pure EngineEvent→BaseEvent, unit tests), `RailyinAgent` (orchestrator bridge), `RailyinRunner` (JSONL persist/replay, unknown-thread connect, synthesized tool results), `jsonl-store.ts` | 1 | Engine turn streams into a scratch CopilotKit UI; reload replays history from JSONL; stop works; old UI + `/ws` untouched |
| 3 | **Interrupts** | `decision_request` → `CUSTOM on_interrupt` + pause; resume via `forwardedProps.command.resume` continuing same execution; port decision renderer into `#interrupt` slot; keep board-card decision entry points working (they now resume via the copilotkit path) | 2 | Full decision cycle: request → render → approve/reject → engine continues → board updates via /ws |
| 4 | **Frontend swap** | Replace custom chat UI with `RailyinChat.vue` (CopilotChat + slots); thread sidebar (own index endpoint or listThreads fallback); `CopilotChatInput` + tools menu (slash commands); ported `#tool-call-*` renderers; delete conversation/chat stores, CodeMirror editor, block-tree code; legacy-import button; board reactivity still on /ws | 2, 3 | Old chat stack deleted; all chat flows through CopilotKit; E2E specs reworked to mock `/api/copilotkit/*` |
| 5 | **Cleanup** | Remove `StreamEvent` protocol, stream-tree, markClaudeExecution, removed features (file_diff, code_review, transition_event, status, usage, compaction_summary, ask_user, shell_approval); freeze old chat tables (stop writes, no drops); delete dead engine bits (FileStateCache, shell gate, code-review executor); retire legacy-import behind flag when imports done | 4 | `git grep` shows zero custom-protocol references; 55 Playwright specs green against new mocks |

**Phase-specific research flags for the roadmap:**
- Spike: verify `POST /stop` path shape (with/without `:threadId`) and `GET /threads`/`listThreads()` availability in the **pinned** version — both are version-sensitive.
- Bridge: verify `AbstractAgent` cloning behavior in pinned `@ag-ui/client` (statelessness expectations), and `compactEvents`/`finalizeRunEvents` semantics from the installed package (not the docs).
- Frontend swap: `useThreads` on self-hosted is capability-gated — decide own-endpoint vs `listThreads()` fallback based on spike result.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 user, local (Railyin target) | Monolith as designed: JSONL per thread, GLOBAL_STORE per process, hono mounted in Bun.serve. Nothing breaks. |
| 10–100 users (multi-instance) | GLOBAL_STORE is per-process → cross-instance connect fails (issue #3553 pattern). JSONL files are already the durable store: point runner at shared filesystem, or swap `jsonl-store` for the community `SqliteAgentRunner`/Redis pattern. |
| 100k+ users | Never for this product (local-first). If it happened: external agent host + Intelligence platform; runner becomes a thin proxy. |

### Scaling Priorities

1. **First bottleneck: JSONL write amplification** — hot token streams append per event. The existing `WriteBuffer` pattern (batch + flush on interval/done) already solves this; reuse it in `jsonl-store.ts`. Not a concern at 1 user.
2. **Second: full-history replay per connect** — PROJECT.md accepts full replay for v1; `compactEvents()` (already in the runner) bounds historic event growth.

## Anti-Patterns

### Anti-Pattern 1: Reimplementing the runner from scratch (extend `AgentRunner` abstract directly)

**What people do:** Subclass `AgentRunner` (4 abstract methods) and hand-roll concurrency guards, event compaction, live-tail replay, dedup.
**Why it's wrong:** You re-derive `InMemoryAgentRunner`'s subtle machinery (ReplaySubject wiring, messageId dedup on connect, `finalizeRunEvents`, concurrent-run policy) — high bug surface, and the docs' own examples (AgentCoreRunner, SqliteAgentRunner) all extend `InMemoryAgentRunner`.
**Do this instead:** Extend `InMemoryAgentRunner`; override only persistence/replay seams and call `super` for lifecycle semantics.

### Anti-Pattern 2: Making the bridge stateful per request (holding run state in the agent)

**What people do:** Store per-thread cursors/AbortControllers on the custom agent instance.
**Why it's wrong:** The runtime clones the registered agent per request (`cloneAgentForRequest`); per-thread state on the agent leaks across requests and is lost between runs.
**Do this instead:** Keep the agent a thin translation layer; per-thread run state lives in the runner's store and a small `threadId → pending execution` registry in the composition root.

### Anti-Pattern 3: Expecting `useThreads` to work self-hosted without checking capability

**What people do:** Assume the sidebar's `useThreads` works against a custom runner because the runtime docs mention thread endpoints.
**Why it's wrong:** Thread list/mutation endpoints are Intelligence-platform features, capability-gated in the runtime; on self-hosted, `useThreads` errors "thread endpoints unavailable" unless the pinned version's local `listThreads()` fallback is active.
**Do this instead:** Verify `/info` capabilities in the spike; plan an own thread-index endpoint (Railyin owns the files) as the reliable path.

### Anti-Pattern 4: Streaming `RUN_FINISHED` while a `decision_request` is pending, then aborting the engine

**What people do:** Treat interrupt as error/abort: cancel the engine, persist state, and start a fresh context on resume.
**Why it's wrong:** Loses engine-side continuation (decision response is injected mid-conversation today); the stack's resume channel (`forwardedProps.command.resume`) exists precisely to continue a paused run.
**Do this instead:** Pause (keep `AbortController` + execution alive), emit `on_interrupt`, and continue the same execution on resume — matching today's decision_batches/records semantics.

### Anti-Pattern 5: Double-broadcasting events (board /ws + chat SSE for the same event)

**What people do:** Keep `StreamEventProcessor` broadcasting chat events over /ws while also feeding the copilotkit SSE path.
**Why it's wrong:** Duplicate rendering paths and the `markClaudeExecution` double-broadcast bug reappears (PROJECT.md explicitly calls this out: it disappears with a single translation path).
**Do this instead:** Single path: EngineEvent → event-bridge → SSE for chat; /ws remains only for task.updated/code.ref/lsp. The bridge is the only translator.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| 5 engine SDKs (pi/claude/copilot/cursor/opencode) | unchanged — behind orchestrator, emit `EngineEvent` | bridge is the only consumer boundary change |
| None other | local-first; no cloud, no CopilotCloud | do NOT pass publicApiKey/licenseToken to `CopilotKitProvider` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Frontend ↔ CopilotRuntime | HTTP `/api/copilotkit/*` (SSE) | replaces custom `StreamEvent` WS protocol for chat |
| Frontend ↔ board | `/ws` (task.updated, code.ref, lsp) + `/api/*` | unchanged; no chat events on /ws after swap |
| CopilotRuntime ↔ RailyinAgent | per-request clone; `runAgent(input, {onEvent})` | agent is the AG-UI side of the bridge |
| RailyinAgent ↔ Orchestrator | `ExecutionCoordinator` interface (existing) | keyed by `conversationId = threadId`; `forwardedProps.command` → execution commands |
| RailyinRunner ↔ JSONL store | file I/O; buffered appends | replay path also synthesizes TOOL_CALL_RESULTs |
| Runner ↔ Runtime | `runner` option on `CopilotRuntime`; `listThreads()` → GET /threads fallback | version-sensitive |
| Legacy import ↔ old tables | read-only SQL over `conversation_messages`/`stream_events` | tables frozen, never dropped; writes stop at frontend swap |

## Sources

- CopilotKit runtime endpoints (`POST /agent/:id/run`, `/connect`, `/stop`, `/info`, `/threads`): docs.copilotkit.ai / showcase shell-docs `runtime-endpoints.mdx` — MEDIUM (context7), cross-checked with docs site
- AgentRunner contract + custom runner guide (`agent-runners.md`, `agent-runners-custom.md`): official docs + GitHub `packages/runtime/src/v2/runtime/runner/in-memory.ts` (UNPKG 1.64.2 source dump) — MEDIUM; lifecycle semantics verified against installed-source dump
- AG-UI event schemas + EventType enum: `github.com/ag-ui-protocol/ag-ui` `packages/core/src/events.ts` via context7 — MEDIUM
- `TEXT_MESSAGE_CHUNK` / `REASONING_MESSAGE_CHUNK` auto-expansion: CopilotKit `protocol-spec.md` + `concepts/reasoning.mdx` — MEDIUM
- Interrupt/resume (`on_interrupt`, `forwardedProps.command.resume`, `#interrupt` slot, `useInterrupt`): `programmatic-control.mdx`, Vue reference docs — MEDIUM
- AWS AgentCoreRunner (unknown-thread connect + synthesized tool results): `packages/agentcore-runner/src/agentcore-runner.ts` — MEDIUM (official example)
- InMemoryAgentRunner cold-start connect gap: GitHub issue #3553 (2026-03-30) — MEDIUM (issue report, matches source)
- `useThreads` Intelligence-mode requirement + capability gating: docs.copilotkit.ai `useThreads` reference, commit `db09796` "gate thread endpoints by runtime capability" — MEDIUM/HIGH (two independent sources)
- Hono handler (`createCopilotHonoHandler`, `createCopilotRuntimeHandler`): CopilotKit runtime skills/references — MEDIUM

---
*Architecture research for: Railyin chat-stack migration to AG-UI + CopilotKit*
*Researched: 2026-08-08*
