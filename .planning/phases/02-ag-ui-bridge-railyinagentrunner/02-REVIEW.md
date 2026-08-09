---
phase: 02-ag-ui-bridge-railyinagentrunner
reviewed: 2026-08-09T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/bun/copilotkit/event-bridge.ts
  - src/bun/copilotkit/event-bridge.test.ts
  - src/bun/copilotkit/railyin-agent.ts
  - src/bun/copilotkit/railyin-agent.test.ts
  - src/bun/copilotkit/jsonl-store.ts
  - src/bun/copilotkit/jsonl-store.test.ts
  - src/bun/copilotkit/railyin-runner.ts
  - src/bun/copilotkit/railyin-runner.test.ts
  - src/bun/engine/coordinator.ts
  - src/bun/engine/execution/chat-executor.ts
  - src/bun/engine/orchestrator.ts
  - src/bun/engine/stream/stream-processor.ts
  - src/bun/engine/testing/mock-engine.ts
  - src/bun/index.ts
  - src/bun/test/execution-seam.test.ts
  - e2e/api/copilotkit/railyin.test.ts
  - e2e/api/fixtures/server.ts
  - package.json
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: clean
---

# Phase 2: Code Review Report

**Reviewed:** 2026-08-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the AG-UI bridge keystone: `event-bridge.ts` (pure EngineEvent → AG-UI translation), `RailyinAgent` (AbstractAgent subclass), `RailyinAgentRunner` (InMemoryAgentRunner + JSONL persistence), `jsonl-store.ts`, the `onEngineEvent`/`onRunEnd` seam through `Orchestrator → ChatExecutor → StreamProcessor`, the workspace resolver, the advisory cross-path lock, and the e2e/unit coverage.

The architecture is sound — pure translation module, runner-level persistence, per-run closure state, double threadId sanitization, and the seam's optional-opts design (absent opts ⇒ byte-identical legacy path) are all well executed. Test coverage is genuinely strong, including wire-level e2e proofs.

However, the review found one structural defect in the translation state machine (subagent/child tool-call id resolution via a single shared counter — breaks on the mainstream subagent-with-tools flow and parallel child calls, producing an invalid AG-UI wire stream), plus a terminal-emission gap on the abort path that violates the phase's own documented `verifyEvents` contract, a completion-guard that is dead code for real (async) engines and permits a permanent thread-lock wedge, an unauthenticated/origin-unchecked loopback execution mount, and a cold-path connect that 500s on malformed threadIds.

Findings were verified against the installed `@ag-ui/client@0.0.57` `verifyEvents` implementation (rejects `RUN_FINISHED` while text messages are active; rejects `TOOL_CALL_RESULT`/`TOOL_CALL_END` for tool ids never started) and the base `InMemoryAgentRunner` lock semantics (lock held until the agent's observable completes).

## Critical Issues

### CR-01: Shared `toolSeq` counter breaks tool-call id resolution when subagent and child tool events interleave

**File:** `src/bun/copilotkit/event-bridge.ts:62-68, 154-160, 163-180`
**Issue:** `state.toolSeq` is a single counter shared by *three* id namespaces: subagent ids (`${callId}::${++toolSeq}`), child/internal tool ids (`${parentCallId}::${callId}::${++toolSeq}`), and their results (which read `toolSeq` *without* incrementing). The start uses `++toolSeq`, the result reads the current value — this only matches when no other counter-consuming event occurs between a start and its result. Trace a subagent that calls tools (the normal case — subagent child events with `parentCallId` are emitted by `copilot/events.ts:116` and interleave between `subagent_start` and `subagent_stop`):

1. `subagent_start(callId: "sa-1")` → `toolSeq` 1 → id `sa-1::1`, pushed to `openToolCallIds`
2. child `tool_start(callId: "c0", parentCallId: "sa-1", isInternal)` → `toolSeq` 2 → id `sa-1::c0::2`
3. child `tool_result` → id `sa-1::c0::` + 2 → `sa-1::c0::2` (accidentally matches)
4. `subagent_stop(callId: "sa-1")` → id `sa-1::` + 2 → **`sa-1::2`** — but the START was `sa-1::1`

The emitted `TOOL_CALL_RESULT` for `sa-1::2` references a tool id that was never started (client `verifyEvents` rejects: "Cannot send 'TOOL_CALL_RESULT' event: No active tool call found"), while `sa-1::1` stays in `openToolCallIds` and gets a second, synthesized empty `TOOL_CALL_RESULT` at finish. The same mismatch occurs for *parallel* child tool calls (child A start → seq n, child B start → seq n+1, child A result reads n+1 → wrong id). Existing tests only cover strictly sequential child calls (`railyin-runner.test.ts` / `event-bridge.test.ts`), so the interleaved shape is untested. `stream-processor.ts:312-324` explicitly handles parallel/reused child callIds — the bridge does not.

**Fix:** Store the seq at start time and reuse it at result time. Track per-call seqs, e.g. keep a `Map<string, number>` keyed by `${parentCallId}\u0000${callId}` (mirroring `childCallKey` in stream-processor) set in `tool_start`/`subagent_start` and consumed in `tool_result`/`subagent_stop`, falling back to `++toolSeq` only when no entry exists. Add tests for: subagent with a child tool call, and two parallel children (A start, B start, A result, B result).

## Warnings

### WR-01: `finish()` emits the terminal without closing open text/reasoning blocks — invalid stream on abort mid-token

**File:** `src/bun/copilotkit/railyin-agent.ts:184-198`
**Issue:** The abort path in `stream-processor.ts:187-204` flushes accumulators and calls `onRunEnd("aborted")` **without** emitting a closing `done` engine event — so `state.textOpen`/`reasoningOpen` are still true when `finish("aborted")` runs. `finish()` emits only the synthesized tool results + terminal; unlike `guardedComplete()` (which calls `translateEngineEvent({type:"done"})` to close blocks), it never emits `TEXT_MESSAGE_END`/`REASONING_MESSAGE_END`. The result is `... TEXT_MESSAGE_CONTENT, RUN_FINISHED` with an active message — exactly the shape the file's own comment (lines 182-184) says `verifyEvents` rejects ("Cannot send 'RUN_FINISHED' while text messages are still active"). `e2e/api/copilotkit/railyin.test.ts` test 9 exercises this exact path (abort during `__SCRIPT_SLOW__` after a token) and passes only because the runtime does not run `verifyEvents` server-side (verified: no `verifyEvents` usage in `@copilotkit/runtime`); a spec-compliant client will reject the stream or leave a dangling text bubble.

**Fix:** In `finish()`, before synthesizing tool results, close any open blocks exactly like the `done`/`error` branch of `translateEngineEvent` (or reuse `translateEngineEvent({ type: "done" }, state)` as `guardedComplete` does) so the terminal always follows the END events.

### WR-02: Completion guard is dead code for real engines — pause/misconfig paths wedge the thread permanently

**File:** `src/bun/copilotkit/railyin-agent.ts:239` and `src/bun/engine/execution/chat-executor.ts:106-120`
**Issue:** `guardedComplete()` only fires when `eventsDuringDispatch` is true at the moment `executeChatTurn`'s promise resolves. Real engines (including the mock — `MockExecutionEngine` yields after `await delay(10)`) dispatch events asynchronously, so `.then` always runs with `eventsDuringDispatch === false`; the guard never fires in production. Two concrete consequences:

1. Any engine stream that ends **without** a terminal after async dispatch (e.g. a non-fatal `error` followed by end-of-stream, or an `ask_user`/`shell_approval` pause where the engine's generator returns instead of parking on `resume`) leaves the agent's subject uncompleted. The base runner's `runAgent` awaits that observable, so `store.isRunning` stays `true` — every subsequent `run`/`connect` on that thread throws "Thread already running" for the rest of the process lifetime.
2. The Pi pre-flight failure path (`chat-executor.ts:106-120`) returns `{ executionId: -1 }` with **no** events and **no** `onRunEnd`. The agent's `.then` runs, `eventsDuringDispatch` is false, nothing emits, and the subject never completes — the client SSE hangs forever (and the runtime mount deliberately disables the idle timeout via `srv.timeout(req, 0)` in `index.ts:373`).

**Fix:** Trigger the completion guard from a place that sees async events — e.g. check `!terminalEmitted` inside `onEngineEvent` when the event type is terminal-causing (`done`/`error` without a subsequent `onRunEnd`), or have the guard fire on a short settle timeout after `executeChatTurn` resolves; and for the pre-flight path, ensure the executor either calls `opts.onRunEnd("error")` or the agent treats `executionId === -1` as an error terminal.

### WR-03: Unauthenticated, origin-unchecked loopback AG-UI mount is a DNS-rebinding/CSRF execution vector

**File:** `src/bun/index.ts:372-375`
**Issue:** `/api/copilotkit/*` is served on `127.0.0.1` with no authentication and no `Origin`/`Host` validation. Any webpage in any browser can POST to `http://127.0.0.1:3000/api/copilotkit/agent/default/run` (DNS rebinding defeats localhost protection) with an **attacker-chosen prompt** for any known conversation id, driving the real engines — including their shell/bash tools — through `RailyinAgent.run` → `executeChatTurn`. The threadId must be a valid conversation id, but conversation ids are sequential integers (trivially enumerable), and the prompt content is fully attacker-controlled. This is a materially more powerful execution surface than the existing `/api/*` RPC router (which also lacks auth but has no free-form agent-prompt primitive), and the runtime path additionally disables the per-request idle timeout. The app's ASVS L1 posture (local single-user) reduces but does not eliminate the risk.

**Fix:** Validate the `Origin` header against the server origin (reject cross-origin POSTs), and/or require a per-process bearer token for the runtime mount; at minimum reject requests whose `Host`/`Origin` is not loopback.

### WR-04: Cold-path `connect()` 500s on malformed threadIds instead of erroring gracefully

**File:** `src/bun/copilotkit/railyin-runner.ts:157-158`
**Issue:** The run path rejects non-numeric/traversal threadIds cleanly (`RUN_ERROR` + `THREAD_NOT_FOUND`, no side effect — T-02-01). The connect cold path, however, calls `this.store.exists(request.threadId)` which **throws** `Invalid threadId` for any non-numeric id (e.g. `connect` with `"../../etc/passwd"`), propagating out of `connect()` and producing a 500 instead of the graceful empty/error stream the run path guarantees. A hostile or buggy client can turn connect into server errors.

**Fix:** Wrap the `store.exists`/`store.read` cold path in a try/catch that falls through to `super.connect(request)` (base completes empty for unknown threads), mirroring the run path's rejection contract.

## Info

### IN-01: `completeOpenToolCalls` keys by raw toolCallId across run boundaries

**File:** `src/bun/copilotkit/railyin-runner.ts:46-101`
**Issue:** The Map is keyed by raw `toolCallId` with no run-scoping. Engines reuse ids like `call_0` across sequential calls/runs (the codebase documents this at `stream-processor.ts:313-320`); if run N leaves `call_0` dangling and run N+1 completes its own `call_0`, the map entry is overwritten by the later run's START and run N's dangling call never gets a synthetic result. Also, all synthesized results are inserted before the **last** terminal, regardless of which run the dangling call belongs to — a wire-order violation for multi-run replays.
**Fix:** Scope the map by run (key on `RUN_STARTED` runId or reset the map at each `RUN_STARTED` boundary) and insert synthesized results before the terminal of the run that owns the dangling call.

### IN-02: `activeRun` instance field is never cleared after completion

**File:** `src/bun/copilotkit/railyin-agent.ts:80, 98-107`
**Issue:** After a run completes, `this.activeRun` still references the finished closure; a late `abortRun()` calls `orchestrator.cancel(staleExecutionId)`, which is a no-op today (status no longer `running`) but is a stale-pointer trap for future code that adds side effects to cancel. Clear `activeRun` when the run reaches a terminal (in `finish`/`guardedComplete`).

### IN-03: Defensive `workspaceKey == null` path double-emits `RUN_STARTED`

**File:** `src/bun/copilotkit/railyin-agent.ts:167, 204-208`
**Issue:** `RUN_STARTED` is emitted at line 167, then `resolveWorkspaceKey` returning null (line 205) routes through `emitRunError`, which emits a **second** `RUN_STARTED` — violating the one-RUN_STARTED-per-run contract (verifyEvents rejects a second RUN_STARTED while a run is active). Currently unreachable (the conversation-existence check at lines 136-142 runs in the same synchronous block), but it is a latent wire-contract violation. Move the `workspaceKey` resolution before the first `RUN_STARTED` emission, or have this path reuse the already-started subject with a plain `RUN_ERROR`.

### IN-04: `tool_result`/subagent events close text/reasoning blocks without emitting END events

**File:** `src/bun/copilotkit/event-bridge.ts:146-161, 163-180`
**Issue:** `tool_result` sets `state.textOpen = false` / `state.reasoningOpen = false` without emitting `TEXT_MESSAGE_END`/`REASONING_MESSAGE_END`, and `subagent_start`/`subagent_stop` don't close open blocks at all. Today this is mostly masked because a non-suppressed `tool_start` always precedes its result and closes blocks with END — but it diverges from the documented close-with-END pattern, and any engine that emits a `tool_result` without a translated `tool_start` (or tokens interleaved around subagent boundaries) produces an unterminated message block on the wire. Keep the close and the END emission atomic (same shape as the `tool_start` branch).

---

_Reviewed: 2026-08-09T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
