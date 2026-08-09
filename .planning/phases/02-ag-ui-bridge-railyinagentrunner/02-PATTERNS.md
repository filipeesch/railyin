# Phase 2: AG-UI Bridge & RailyinAgentRunner — Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 15 (7 new, 8 modified/optional)
**Analogs found:** 12 / 15 (3 "no analog" — runner subclass + its test + rxjs pin use RESEARCH.md + verified node_modules contracts)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/bun/copilotkit/railyin-agent.ts` (NEW) | agent/bridge (controller) | event-driven | `e2e/api/copilotkit/probe-agent.ts` | exact |
| `src/bun/copilotkit/event-bridge.ts` (NEW) | utility (pure translation) | transform | `src/bun/engine/stream/stream-processor.ts` (switch dispatch) + `src/bun/engine/dialects/claude-dialect.ts` (pure module shape) | role-match |
| `src/bun/copilotkit/railyin-runner.ts` (NEW) | service (runner subclass) | event-driven / streaming | none in-repo → RESEARCH.md Pattern 1 + `node_modules/@copilotkit/runtime/dist/v2/runtime/runner/in-memory.mjs:297-432`; subclass-override shape from `src/bun/test/executor-test-helpers.ts:71-91` (StubStreamProcessor) | partial |
| `src/bun/copilotkit/jsonl-store.ts` (NEW) | utility (persistence) | file-I/O | `src/bun/oauth/token-store.ts` + `src/bun/utils/platform.ts:16-18` | exact |
| `src/bun/copilotkit/event-bridge.test.ts` (NEW) | test | unit | `src/bun/pipeline/stream-event-enricher.test.ts` | exact |
| `src/bun/copilotkit/jsonl-store.test.ts` (NEW) | test | unit | `src/bun/test/helpers.ts` (initDb/makeTempDir) + `src/bun/oauth/token-store.ts` | role-match |
| `src/bun/copilotkit/railyin-runner.test.ts` (NEW) | test | unit | none in-repo → RESEARCH.md Validation Architecture + Pitfall 2 (lock assert) | no analog |
| `src/bun/copilotkit/railyin-agent.test.ts` (NEW) | test | unit | `src/bun/test/handlers.test.ts:97` (fake ExecutionCoordinator literal) + `src/bun/test/chat-executor.test.ts` | role-match |
| `e2e/api/copilotkit/railyin.test.ts` (NEW) | test | e2e (SSE) | `e2e/api/copilotkit/copilotkit.test.ts` | exact |
| `src/bun/engine/coordinator.ts` (MOD) | interface (config) | request-response | itself — additive `opts?` param on line 10 | exact |
| `src/bun/engine/orchestrator.ts` (MOD) | controller | request-response | itself — `executeChatTurn` lines 163-174 pass-through | exact |
| `src/bun/engine/execution/chat-executor.ts` (MOD) | service | event-driven | itself — existing `onNewMessage` callback threading (line 33) | exact |
| `src/bun/engine/stream/stream-processor.ts` (MOD) | service | event-driven | itself — `this.onStreamEvent?.()` optional-callback pattern; `consume()` lines 184-593 | exact |
| `src/bun/index.ts` (MOD) | composition root | config | itself — env-gated CopilotRuntime mount lines 245-277 | exact |
| `src/bun/testing/mock-engine.ts` (MOD) | test double | event-driven | `src/bun/test/executor-test-helpers.ts` TestEngine + `e2e/api/copilotkit/probe-agent.ts` scripted-props pattern | role-match |
| `e2e/api/fixtures/server.ts` (MOD, optional) | fixture | config | itself — `StartServerOptions`/`extraEnv` lines 22-39, 140-150 | exact |
| `package.json` + `e2e/api/copilotkit/pins.test.ts` (MOD, optional) | config | n/a | `pins.test.ts` itself (rxjs pin extension) | exact |

## Pattern Assignments

### `src/bun/copilotkit/railyin-agent.ts` (agent, event-driven)

**Analog:** `e2e/api/copilotkit/probe-agent.ts` (the exact AbstractAgent shape this phase must mirror — D-01/D-03, RESEARCH.md Code Examples lines 394-411)

**Imports pattern** (probe-agent.ts:23-25):
```typescript
import { AbstractAgent } from "@ag-ui/client";
import { EventType, type AGUIEvent, type RunAgentInput } from "@ag-ui/core";
import { from } from "rxjs";
```

**Class + run() shape** (probe-agent.ts:51-63) — note the rxjs nested-version cast is REQUIRED (top-level rxjs@7.8.2 `from()` feeding @ag-ui/client's nested 7.8.1 pipeline):
```typescript
export class ScriptedAgent extends AbstractAgent {
  constructor() { super({ agentId: "default", description: "Spike probe agent" }); }
  run(input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    return from(this.generateEvents(input)) as unknown as ReturnType<AbstractAgent["run"]>;
  }
```

**Event contract to preserve** (probe-agent.ts:10-21 doc comment + :71-81): emit `RUN_STARTED` FIRST (with `input` — RESEARCH correction: emitting WITH input avoids the runner's message filtering), then translated events, then the terminal `RUN_FINISHED { threadId, runId, result: null }` yourself — `finalizeRunEvents` otherwise appends `RUN_ERROR {code:"INCOMPLETE_STREAM"}`. The `buildQuickRunEvents` builder (probe-agent.ts:36-44) is the canonical event-source pattern to replicate for the bridge's terminal-synthesis test fixtures.

**NEW vs probe — the pieces probe doesn't have:**
- `clone()` override (Pitfall 1): `clone() { const c = super.clone(); c.orchestrator = this.orchestrator; c.db = this.db; ...; return c; }` — default `AbstractAgent.clone()` copies ONLY the fixed field list (agentId, description, threadId, messages, state, debug fields, subscribers, middlewares, pendingInterrupts). Unit test: `clone().orchestrator === original.orchestrator`.
- `abortRun()` override: base is a no-op — route to `orchestrator.cancel(executionId)` (interface: `coordinator.ts:12` `cancel(executionId: number): void`).
- Per-run machinery (AbortController, ReplaySubject, tool-call tracking) lives in the run closure, NEVER as agent instance fields (anti-pattern: per-thread state on the agent — the runtime clones per request).
- Agent resolves engine via the orchestrator only — no direct engine access (D-10). Run-locking advisory check (Open Question 2): `SELECT 1 FROM executions WHERE conversation_id = ? AND status IN ('running','waiting_user')` before starting.

### `src/bun/copilotkit/event-bridge.ts` (utility, transform — pure, no I/O)

**Analog:** `src/bun/engine/stream/stream-processor.ts` `consume()` switch (lines 204-527) — the exhaustive `EngineEvent` family dispatch the bridge mirrors 1:1; `src/bun/engine/dialects/claude-dialect.ts` for the pure-module shape (no deps, co-located test).

**Source union to dispatch on:** `src/bun/engine/types.ts:20-50` (`EngineEvent`). Mapping table (RESEARCH D-03, with the D-03 correction from State of the Art — the BRIDGE emits the terminal, not the base runner):

| EngineEvent | AG-UI Event(s) |
|---|---|
| `token` | `TEXT_MESSAGE_START` (once, `messageId` per block) + `TEXT_MESSAGE_CONTENT {messageId, delta}` + `TEXT_MESSAGE_END` |
| `reasoning` | `REASONING_MESSAGE_START {messageId, role:"reasoning"}` + `REASONING_MESSAGE_CONTENT {messageId, delta}` + `REASONING_MESSAGE_END` |
| `tool_start` | `TOOL_CALL_START {toolCallId, toolCallName, parentMessageId?}` + `TOOL_CALL_ARGS {toolCallId, delta}` + `TOOL_CALL_END` |
| `tool_result` | `TOOL_CALL_RESULT {messageId, toolCallId, content, role?:"tool"}` — `messageId` REQUIRED (Pitfall 5: generate `${toolCallId}-result`) |
| `done` | bridge appends `RUN_FINISHED {threadId, runId, result:null}` |
| `error` (fatal) | bridge appends `RUN_ERROR {message, code}` |
| abort/stream-end | `RUN_FINISHED` (stopped) |
| `subagent_start`/`subagent_stop` | tool-call pair with namespaced ids |
| `ask_user`/`decision_request`/`shell_approval`/`status`/`usage`/`task_updated`/`new_message`/`compaction_*` | **Phase 2: ignore** (board `/ws` path is UNCHANGED — no double-broadcast, BRDG-01) |

**Tool callId namespacing** (Pitfall 6): copy the `childCallKey`/`childLiveBlockIdByCall` namespacing pattern from `stream-processor.ts:163-165, 313-319` — `${parentCallId}::${callId}::${seq}`.

**Tool-call completion at run end** (D-09/A5): after the terminal, run a local `completeOpenToolCalls(events)` pass (synthesize `TOOL_CALL_END` + `TOOL_CALL_RESULT {messageId: ${toolCallId}-result, toolCallId, content:""}` for any dangling `TOOL_CALL_START`) BEFORE `RUN_FINISHED` — the persisted log must never contain dangling calls. Do NOT rely on `finalizeRunEvents` for this (it early-returns when a terminal exists).

**Error handling pattern** — none needed (pure function); throw on impossible input, let the agent's run catch wrap into `RUN_ERROR`.

### `src/bun/copilotkit/railyin-runner.ts` (service, event-driven)

**Analog:** no in-repo runner exists. Use RESEARCH.md Pattern 1 (skeleton at RESEARCH.md:203-221) + the verified base contract in `node_modules/@copilotkit/runtime/dist/v2/runtime/runner/in-memory.mjs:297-432` (excerpts in RESEARCH.md:356-392). Import path VERIFIED: `InMemoryAgentRunner`, `AgentRunnerRunRequest`, `AgentRunnerConnectRequest` all exported from `@copilotkit/runtime/v2` (node_modules/@copilotkit/runtime/dist/v2/index.d.mts:13,21 — same import path `src/bun/index.ts:35` already uses for `CopilotRuntime`).

**Subclass-with-override shape** (copy the structure from `src/bun/test/executor-test-helpers.ts:71-91` — StubStreamProcessor extends + `super(...)` + `override` methods):
```typescript
import { InMemoryAgentRunner, type AgentRunnerRunRequest, type AgentRunnerConnectRequest } from "@copilotkit/runtime/v2";
import { Observable, tap } from "rxjs";
import type { BaseEvent } from "@ag-ui/client";

export class RailyinAgentRunner extends InMemoryAgentRunner {
  constructor(private readonly store: JsonlStore) { super(); /* onConcurrentRun stays "throw" */ }

  override run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return super.run(request).pipe(tap({
      next: (event) => void this.store.append(request.threadId, event), // append-only, per event
      complete: () => this.store.endRun(request.threadId),
    }));
  }
  // connect(): hot path (in-memory store has thread) → super.connect();
  // cold path (file exists, fresh process) → completeOpenToolCalls → compactEvents → emit replay;
  // never-run (no file) → super.connect() (base completes empty — RUNR-06, Phase 1 test 5)
}
```

**Key contract points (from verified in-memory.mjs):**
- `run()` throws `Error("Thread already running")` synchronously BEFORE returning the observable when the thread is running — pass NO options to keep the throw (RESEARCH.md:199). The persisted log must capture exactly what the client received → pipe `super.run()` through the `tap` (never persist from inside `agent.run()` — the runner patches `RUN_STARTED.input` after the agent emits, RESEARCH anti-pattern line 257).
- `connect()` cold path is THE #3553 fix (D-04): replay = `completeOpenToolCalls(events)` → `compactEvents(events)` (from `@ag-ui/client`, export verified index.d.mts:613) → emit verbatim. If log's LAST run lacks a terminal, complete with `finalizeRunEvents` (export verified from `@copilotkit/runtime/v2`). Safe fallback for errored-run-then-run logs (Pitfall 4): truncate replay at first `RUN_ERROR`.
- Test at unit level: `expect(() => runner.run(...)).toThrow("Thread already running")` — over SSE it is HTTP 200 + empty body, NOT 500 (Pitfall 2).

### `src/bun/copilotkit/jsonl-store.ts` (utility, file-I/O)

**Analog:** `src/bun/oauth/token-store.ts` — EXACT match for the pure-ish file module (no constructor deps, path helpers, tolerant read, sync writes):

**Path + tolerant-read pattern** (token-store.ts:14-45):
```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { dirname, join } from "path";

export function threadLogPath(dataDir: string, threadId: string): string {
  return join(dataDir, "threads", `${threadId}.jsonl`);
}
// read pattern (token-store.ts:31-39): existsSync → readFileSync → parse; return null/empty on absent.
// write pattern (token-store.ts:41-45): mkdirSync(dirname, {recursive:true}) then write/append.
```

**Data dir resolution:** `getDataDir()` from `src/bun/utils/platform.ts:16-18` (`process.env.RAILYN_DATA_DIR ?? join(homedir(), ".railyn")`) — inject at construction from the composition root (research Pattern 3, RESEARCH.md:240-244).

**Line schema (research recommendation):** one `BaseEvent` JSON per line, verbatim `JSON.stringify(event)`; first line = run's `RUN_STARTED` (with `input.messages` = the user turn). No envelope in v1. Tolerant reader: skip + log partial trailing line (Pitfall 7), never fail the whole file.

**Sanitization (MUST — security V5/V8):** reject threadIds not matching `^\d+$` before ANY filesystem use (`conversations.id` is INTEGER AUTOINCREMENT); containment-check the resolved path; unit-test `../` and absolute-path attempts. API per research: `append(threadId, event)`, `read(threadId): BaseEvent[] | null`, `exists(threadId)`, `endRun(threadId)`.

### `src/bun/copilotkit/event-bridge.test.ts` (unit test)

**Analog:** `src/bun/pipeline/stream-event-enricher.test.ts` — co-located pure-module test, `bun:test` imports (line 1: `import { describe, test, expect, beforeEach } from "bun:test"`), table-driven `test()` per mapping family. **Validation:** parse every emitted event with `EventSchemas` from `@ag-ui/core` (zod-parse bridge output — RESEARCH Don't Hand-Roll row 4). Cover: every EngineEvent family → valid AG-UI event; terminal paths (done/error/abort) each end in exactly one terminal (Pitfall 3); dangling tool call → synthetic result before RUN_FINISHED (D-09); toolCallId namespacing uniqueness (Pitfall 6); `TOOL_CALL_RESULT.messageId` present (Pitfall 5).

### `src/bun/copilotkit/jsonl-store.test.ts` (unit test)

**Analog:** `src/bun/test/helpers.ts` `initDb()`/`makeTempDir()` (lines 265-268: `mkdtempSync(join(tmpdir(), "railyn-test-"))` + cleanup) + `setupTestConfig` cleanup discipline (lines 386-396). Test: append/read/exists round-trip; missing file → `null`; traversal rejection (`../`, absolute paths) — mirror the sanitize-before-filesystem-use order; partial trailing line tolerated.

### `src/bun/copilotkit/railyin-agent.test.ts` (unit test)

**Analog:** `src/bun/test/handlers.test.ts:97` — object-literal fake `ExecutionCoordinator` (`executeChatTurn: async () => { throw new Error("not implemented"); }`); `src/bun/test/chat-executor.test.ts:88-93` for construction-with-fakes conventions. Agent tests use a fake coordinator that returns a scripted `EngineEvent` sequence via the `onEngineEvent` callback (feed events synchronously, then call `onRunEnd("done")`). Assert: RUN_STARTED first; clone() preserves injected deps (Pitfall 1); abortRun() calls `cancel`; terminal always emitted (Pitfall 3).

### `src/bun/copilotkit/railyin-runner.test.ts` (unit test)

**No in-repo analog** — use RESEARCH.md Validation Architecture (replay-shape checklist, RESEARCH.md:294) + Pitfall 2. Test: lock throw on concurrent run; 4 replay shapes (missing file / 0-run file / N completed runs / interrupted run + errored-run-then-run); empty connect for unknown thread (Phase 1 test 5 contract, copilotkit.test.ts:127-135); JSONL contains exactly the wire events (pipe-tap).

### `e2e/api/copilotkit/railyin.test.ts` (e2e test)

**Analog:** `e2e/api/copilotkit/copilotkit.test.ts` — copy verbatim the scaffolding:
- `startServer({ copilotkitProbe: true })` beforeAll + `server.shutdown()` afterAll (lines 18-26)
- `postJson` raw fetch + `accept: "text/event-stream"` header (lines 29-35) — AG-UI endpoints are NOT reachable via the typed `server.request()` (RPC contract boundary, file header comment lines 3-9)
- `parseSseFrames` frame splitter (lines 38-43)
- `runInput(threadId, runId, forwardedProps)` minimal RunAgentInput builder (lines 46-56)
- Assert zero frames for concurrent run (Pitfall 2: HTTP 200 + empty body, NOT 500)
- JSONL file assertion: `server.dataDir` is populated when `startServer({ mcpConfig })` is passed (server.ts:142-147 sets `RAILYN_DATA_DIR`) — reuse that seam; read `join(dataDir, "threads", "<threadId>.jsonl")` after a run (RUNR-02).
- Extend the mock engine via `RAILYN_TEST_EXECUTION_ENGINE=mock` (server.ts:170) for tool/reasoning scenarios on the real wire.

### `src/bun/engine/coordinator.ts` (MOD — additive)

Add optional `opts?: { onEngineEvent?: (e: EngineEvent) => void; onRunEnd?: (o: "done"|"error"|"aborted"|"decision") => void }` as the LAST parameter of `executeChatTurn` (line 10, RESEARCH.md:447-453). No existing callers change (optional trailing param). Import `EngineEvent` type from `./types.ts` (file already imports from it, line 2).

### `src/bun/engine/orchestrator.ts` (MOD — pass-through)

`executeChatTurn` (lines 163-174) gains the same trailing `opts?` param and passes it to `this.chatExecutor.execute(...)` — a pure pass-through, mirroring how `attachments`/`engineContent` already flow (lines 170-173).

### `src/bun/engine/execution/chat-executor.ts` (MOD — thread the seam)

`execute()` (lines 36-45) gains the trailing `opts?` param; the ONLY call-site change is line 187: `this.streamProcessor.runNonNative(null, conversationId, executionId, engine, execParams, opts)` — or, to match the existing optional-callback style, add the callbacks at the `runNonNative` call. Constructor-injected callback precedent: `private readonly onNewMessage?: (msg: ConversationMessage) => void` (line 33) + guarded `if (this.onNewMessage)` usage (lines 109-114). `sessionId` is NOT referenced in the execute body (research A3) — the agent may pass 0.

### `src/bun/engine/stream/stream-processor.ts` (MOD — the seam)

**Seam locations (verified, RESEARCH.md:234):**
- `consume()` `for await` loop top (line 184): call `opts.onEngineEvent?.(event)` FIRST for every raw event — exact ordering, byte-identical when absent.
- `onRunEnd` terminal points: `case "done"` (line 415), fatal `case "error"` (line 446), both abort paths (lines 184-202 and 531-547), `case "decision_request"` (line 484 → `"decision"`).
- `runNonNative` (lines 124-138) gains the optional opts param and forwards to `consume(...)`.
- **Error handling pattern to preserve:** the try/catch/finally in `consume()` (lines 548-593) — `onRunEnd("error")` fires inside the catch BEFORE rethrow/return, so the bridge's `RUN_ERROR` mirrors the DB `failed` status. The `markClaudeExecution` hack (lines 50, 68-75, 215, 226) becomes dead weight once the AG-UI bridge owns chat translation — remove it per D-02 ("the Claude markClaudeExecution hack disappears") and its callers (`orchestrator.ts:178-180`, `index.ts:235`).

### `src/bun/index.ts` (MOD — D-12 runtime swap)

Replace the probe-only agents map (lines 256-277) with:
```typescript
const copilotProbeEnabled = process.env.RAILYN_COPILOTKIT_PROBE === "1";
let scriptedAgent: unknown;
if (copilotProbeEnabled) {
  const probeModule = await import("../../e2e/api/copilotkit/probe-agent.ts");  // gate BEFORE real registration (Pitfall 9)
  scriptedAgent = probeModule.scriptedAgent;
}
const runner = new RailyinAgentRunner(jsonlStore);           // JsonlStore(dataDir) — inject getDataDir() here
const copilotRuntime = new CopilotRuntime({
  agents: copilotProbeEnabled ? { default: scriptedAgent } : { default: railyinAgent },
  runner,                                                    // CopilotRuntimeOptions.runner verified (runtime.d.mts:152-153)
});
```
Preserve: the `type CopilotAgents` cast bridge (lines 268-271, nested-rxjs type gap), the `srv.timeout(req, 0)` SSE override (line 349), and the multi-route handler (lines 273-277). Composition-root DI pattern precedent: `orchestrator` construction + late-binding (lines 228-236); the agent gets `db`, `orchestrator` via constructor injection (clone() re-attaches them).

### `src/bun/testing/mock-engine.ts` (MOD — scripted scenarios)

**Analog:** `src/bun/test/executor-test-helpers.ts:7-28` TestEngine (minimal `ExecutionEngine` stub) + `e2e/api/copilotkit/probe-agent.ts:46-49` forwardedProps-driven scripting (`{ script?: "quick" | "silence"; silenceMs?: number }`). Extend `MockExecutionEngine.execute` (lines 18-37) so the script comes from `params` (e.g. `params.model`/`params.prompt` marker or a new `ExecutionParams` field) and yields scripted `tool_start`/`tool_result`/`reasoning`/`done` sequences — keep the existing `copilot/mock-model` listModels contract (lines 45-52) and the abort-check rhythm (`if (params.signal.aborted ...) return;` before each yield, lines 24-30) so existing e2e stays green.

### `e2e/api/fixtures/server.ts` (MOD, likely minimal)

`dataDir` + `RAILYN_DATA_DIR` seam already exists (lines 142-147) and `copilotkitProbe` (148-150) — JSONL e2e isolation reuses them as-is. Only extend if the new e2e needs a distinct flag; otherwise no change.

### `package.json` + `pins.test.ts` (MOD, optional — rxjs explicit pin)

`bun add rxjs@^7.8.2` (already hoisted at 7.8.2; research recommends explicit pin, RESEARCH.md:119-123). Extend `e2e/api/copilotkit/pins.test.ts` (exact-pin assertion pattern, lines 28-34) with `expect(pkg.dependencies["rxjs"]).toBe("^7.8.2")`.

## Shared Patterns

### ThreadId sanitization (security V5/V8 — path traversal)
**Source:** RESEARCH.md Pattern 3 (RESEARCH.md:244) + `src/bun/oauth/token-store.ts:41-45` path handling
**Apply to:** `jsonl-store.ts` (all filesystem entry points); the runner/agent call it BEFORE any store use
```typescript
const THREAD_ID_RE = /^\d+$/;                    // conversations.id is INTEGER AUTOINCREMENT
if (!THREAD_ID_RE.test(threadId)) throw new Error(`Invalid threadId: ${threadId}`);
// + resolved-path containment check (path.resolve(...).startsWith(threadsDir))
```

### Optional-callback threading (the executeChatTurn seam)
**Source:** `src/bun/engine/stream/stream-processor.ts:63-65, 200` (`setOnStreamEvent`/`this.onStreamEvent?.()`) + `chat-executor.ts:33, 109-114` (constructor callback + `if` guard)
**Apply to:** `coordinator.ts` → `orchestrator.ts` → `chat-executor.ts` → `stream-processor.ts` (4-layer additive thread); behavior byte-identical when `opts` is absent (research A1)

### consume() error handling (terminal-outcome mapping)
**Source:** `src/bun/engine/stream/stream-processor.ts:548-593` (try/catch/finally with DB status updates)
**Apply to:** `onRunEnd` firing at exactly the 4 terminal points (lines 415, 446, 484, 531-547) so the bridge's RUN_FINISHED/RUN_ERROR mirrors DB `completed`/`failed`/`cancelled` states

### Test scaffolding
**Source:** `src/bun/test/helpers.ts` (`initDb` :10-61, `setupTestConfig` :311-397, `seedChatSession` :409-434, `makeTestRegistry` :442-446, `makeTempDir` :265-268)
**Apply to:** all four `src/bun/copilotkit/*.test.ts` — note: agent/runner tests construct with fakes, NOT via initDb unless DB mapping is under test (agent's thread-mapping resolver uses real DB per research Open Question 3)

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/bun/copilotkit/railyin-runner.ts` | service | event-driven | No runner exists in-repo; the pattern comes from the installed `InMemoryAgentRunner` base (`node_modules/@copilotkit/runtime/dist/v2/runtime/runner/in-memory.mjs:297-432`, excerpts in RESEARCH.md:356-392) + RESEARCH.md Pattern 1 skeleton (RESEARCH.md:203-221). Extend + call `super`, never reimplement (anti-pattern, RESEARCH.md:255) |
| `src/bun/copilotkit/railyin-runner.test.ts` | test | unit | No runner tests exist; use RESEARCH.md replay-shape checklist (RESEARCH.md:294) + Pitfall 2 lock assertion + Phase 1 empty-connect contract (copilotkit.test.ts:127-135) |
| `e2e/api/copilotkit/railyin.test.ts` | test | e2e (SSE) | No real-agent e2e exists (only probe); scaffold from `copilotkit.test.ts` (exact analog for helpers) but the wire expectations (tool/reasoning events through `RailyinAgent` + mock engine) are new — see Wave 0 e2e item (RESEARCH.md:546) |

## Metadata

**Analog search scope:** `src/bun/` (engine, engine/execution, engine/stream, engine/dialects, testing, test, oauth, pipeline, utils, handlers, conversation, index.ts), `e2e/api/copilotkit/`, `e2e/api/fixtures/`, `node_modules/@ag-ui/client/dist/index.d.mts`, `node_modules/@copilotkit/runtime/dist/v2/index.d.mts` (+ runner/*)
**Files scanned:** ~30
**Pattern extraction date:** 2026-08-09
**Imports verified this session:** `InMemoryAgentRunner`/`AgentRunnerRunRequest`/`AgentRunnerConnectRequest`/`finalizeRunEvents` from `@copilotkit/runtime/v2` (index.d.mts:13-21); `AbstractAgent`/`compactEvents`/`verifyEvents` from `@ag-ui/client` (index.d.mts:546, 613, 629); `EventType`/`RunAgentInput`/`AGUIEvent` from `@ag-ui/core` (probe-agent.ts:24)
