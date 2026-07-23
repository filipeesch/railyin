## Context

Cursor engine runs execute `@cursor/sdk` in-process (`InProcessCursorAdapter.run()` in `src/bun/engine/cursor/inprocess-adapter.ts`), consuming `run.stream()` in a `for await` loop and awaiting `run.wait()` at stream end. This already correctly surfaces SDK-observed terminal errors (`result.status === "error"`) as a fatal `EngineEvent.error`.

Investigation (external, pre-implementation exploration — see decision records on this task) established:
- `@connectrpc/connect-node` (bundled transitively via `@cursor/sdk`) has known, currently-unfixed upstream bugs (`connectrpc/connect-es#1678`, `#1561`) where an HTTP/2 stream/session can be torn down mid-flight with an unmapped/unhandled reset code, so the internal sentinel Promise is never rejected — the failure never surfaces to `run.wait()` or any catchable error, and the run's stream simply stops emitting.
- `@cursor/sdk@1.0.23` exposes a documented (but effectively undocumented in its bundled `.d.ts`) escape hatch: `Cursor.configure({ local: { useHttp1ForAgent: true } })`, which forces local-agent backend streams onto HTTP/1.1 + SSE instead of HTTP/2 — sidestepping the `Http2SessionManager` class of bugs entirely for local-agent traffic. Cursor's own docs note "Bun defaults to HTTP/1.1 due to upstream HTTP/2 compatibility issues" — implying Cursor is aware Bun+HTTP/2 is fragile, but static analysis of the bundled SDK could not fully confirm this flag is consulted by every internal call path used by the local executor (some chunks reference an unrelated on-disk CLI settings field of the same name).
- There is a real, separate, currently-harmless bug in `translate-events.ts`'s `"status"` case: it reads `message.message` (undefined on the SDK's actual `SDKStatusMessage` shape, which has `status` and optional `message`), so status transitions never reach the UI meaningfully.
- The existing "Engine session lost; restarted as new execution" fallback in `human-turn-executor.ts` already provides a working recovery path, triggered when `CursorEngine.resume()` throws (which it always does by design for Cursor, since Cursor has no in-turn resume). This path needs no structural change — it just needs to also fire when the watchdog (below) marks a run dead.

## Goals / Non-Goals

**Goals:**
- Reduce the frequency of the underlying HTTP/2 session-teardown failure by forcing HTTP/1.1 for local-agent SDK traffic (primary fix).
- Guarantee that when a Cursor run does stall — regardless of exact internal cause, known or unknown — it always terminates with a fatal `EngineEvent.error` within a bounded time, rather than hanging silently forever (backstop fix).
- Fix the `translate-events.ts` status-field bug as a small, independently-diagnosed correctness fix bundled into this change.
- Preserve the existing behavior for all already-working paths: `run.wait()`-observed errors, `AgentBusyError` retry/recreation, decision_request suspend-loop, abort-driven cancellation.

**Non-Goals:**
- Not attempting to patch or vendor a fix for the upstream `@connectrpc/connect-es` bug itself.
- Not adding a generic (all-engines) stall-watchdog mechanism to `stream-processor.ts` — this is scoped to Cursor only, since the failure mode is specific to `@cursor/sdk`'s bundled transport.
- Not adding a startup reconciliation sweep for crash-orphaned executions — out of scope (see decision record; the motivating case was a false positive).
- Not changing the `CursorRunConfig`/`ExecutionEngine` public contracts — the watchdog is entirely internal to the adapter/engine.

## Decisions

### 1. HTTP/1.1 forcing via `Cursor.configure()` at module load

Call `Cursor.configure({ local: { useHttp1ForAgent: true } })` once, at the same place `setMaxListeners(0)` is currently called in `inprocess-adapter.ts` (module top-level, so it applies before the first `Agent.create`/`Agent.resume`). This mirrors the existing pattern of process-wide, one-time SDK configuration in this file.

**Alternative considered**: per-agent option on `LocalAgentOptions`. Rejected — the option does not exist there; `Cursor.configure()` is the only documented surface for this setting, and it is explicitly process-wide by design (not per-run), so there is no finer-grained alternative to consider.

### 2. Per-run stall watchdog implemented via `Promise.race` around stream iteration, not a generic timer

`InProcessCursorAdapter.run()`'s `for await (const message of run.stream())` loop cannot be preempted by an external timer while it is suspended waiting on the SDK's async iterator — a plain `setTimeout` cannot "inject" a yield into a paused generator. Instead:

- Manually drive the stream's iterator (`const iterator = run.stream()[Symbol.asyncIterator]()`).
- On each iteration, `Promise.race([iterator.next(), timeoutPromise])`.
- Reset (clear + restart) the stall timer on every successful `iterator.next()` resolution (i.e. every SDK message, not just every translated event — this is a superset and simpler to implement at the same call site).
- If the timeout wins the race: mark the run as stalled, call `state.run?.cancel()` (best-effort, matching the existing abort path's `.catch(() => {})` pattern), and yield a single fatal `EngineEvent.error` with a message identifying it as a stall timeout (e.g. `"Cursor run stalled: no SDK event for {N}ms"`), then break out of the loop — following the same shape as the existing `onAbort`/`state.aborted` early-break pattern already in the file.
- The watchdog does NOT fire while `state.aborted` is true (an intentional abort in progress) — only while the run is expected to still be actively streaming.

**Alternative considered**: wrap the entire `run()` generator call in an external `Promise.race` from `engine.ts`. Rejected — per decision record (#1091), the watchdog must live inside `CursorEngine`/`InProcessCursorAdapter`, not leak into shared/generic engine code; also, racing the *entire* generator from outside would lose all events already yielded from earlier iterations before a stall occurs mid-run, since you cannot "partially" race an async generator without also driving its iterator manually — so the logic has to live at the iterator-driving level regardless of which file it's in, making the adapter the natural (and mandated) home.

**Alternative considered**: `AbortSignal.timeout()` composed into the existing abort controller, treating a stall identically to an external abort. Rejected — a stall must be distinguishable from a genuine caller-initiated cancellation (different log message, different fatal-error text, and per decision #1083 must be logged distinctly for observability), and reusing the abort signal would make `state.aborted` true, which would suppress the trailing `{ type: "done" }` sentinel and any distinguishing error yield in the current code's `finally`/post-loop logic.

### 3. Stall threshold: injectable constructor parameter with a fixed real-world default (revised)

`InProcessCursorAdapter` takes a `stallTimeoutMs` constructor parameter, defaulting to a real-world value (proposed: 5 minutes / `5 * 60_000`). It is NOT exposed via `engines.yaml` or an environment variable in this change — the only consumer of the non-default value is the test suite. This directly mirrors the existing `DefaultCopilotSdkAdapter` precedent (`src/bun/engine/copilot/session.ts`), which takes an injectable `deadline` constructor param for its own inactivity-eviction logic and is exercised in its own test (`copilot-sdk-adapter.test.ts`, test "A4") with a 50ms override instead of a real 5-second wait.

Tool calls (shell commands, long edits) can legitimately run for minutes; 5 minutes balances catching genuine stalls against false-positives on slow-but-healthy turns. The threshold can be revisited/exposed as end-user-facing config later if false positives are observed in production — deferring that complexity until there's real signal is preferable to guessing at a config surface now.

**Alternative considered**: hardcoded internal module-level constant (no constructor injection). Rejected on revision — this would force unit tests covering the stall path to either introduce `vi.useFakeTimers()`/`vi.advanceTimersByTime()` (a pattern not used anywhere else in this codebase for timeout-race logic, and a new convention with its own risk of subtly interacting with the `Promise.race` + manually-driven-iterator implementation) or wait out the real 5-minute constant in CI (impractical). Constructor injection avoids introducing a new testing pattern by reusing one already proven in this codebase for the same problem class.

**Alternative considered**: making the threshold configurable via `engines.yaml`/environment variable now. Rejected for this change — no evidence yet of what the "right" default is, and adding *end-user-facing* config before we have a value to justify defaults would be premature. This is distinct from (and does not conflict with) the constructor-injection decision above, which is purely an internal testability seam, not a new user-facing capability.

### 4. Structured stall logging correlated to `execution_id`

Both the stall watchdog's fatal yield and (where feasible) the raw `ConnectError: Session closed with error code 6` rejection path get a structured `console.error` line (matching the existing `[cursor] ${JSON.stringify(...)}` pattern already used for `PersistentBusyError` in `inprocess-adapter.ts`), tagged with `executionId`/`taskId`/`conversationId`/`agentId` so future occurrences are traceable in `bun.log` instead of anonymous "Unhandled rejection" lines.

### 5. `translate-events.ts` status fix

Change `case "status"` to read `message.status` (the real field per the SDK's `SDKStatusMessage` type) instead of `message.message`. Fall back to an empty string only if `status` itself is somehow absent (defensive, matches existing `String(x ?? "")` idiom already in the file).

### 6. No structural change to `human-turn-executor.ts`

The watchdog's fatal `EngineEvent.error` flows through the exact same `for await (const event of this.adapter.run(runConfig))` loop in `engine.ts`'s `_run()` and the same `stream-processor.ts` error-handling path that already exists for any other fatal error — which already marks the execution `failed` in the DB. `human-turn-executor.ts`'s fallback-restart branch is triggered on the *next* user turn by `CursorEngine.resume()` throwing (unchanged, pre-existing contract) once the execution is in a terminal `failed` state. No new code path is needed there; this decision documents that the existing contract already composes correctly with the new watchdog, closing decision #1083's "make resume-recovery more proactive" concern — the watchdog itself IS the proactive trigger, by ensuring a `failed` state is reached promptly instead of the execution staying `running` indefinitely.

Verified during test-coverage exploration: `human-turn-executor.ts`'s fallback-restart branch (rollback + new execution) only triggers when `task.execution_state === "waiting_user"`. A watchdog-caused fatal error leaves `execution_state = 'failed'` (via `stream-processor.ts`'s standard fatal-error handling), which is a *different* branch than `waiting_user` — it falls through to `execute()`'s plain "start a new execution" path at the bottom of the method, not the `resume()`-throw catch block. Confirmed no RPC-level guard in `src/bun/handlers/tasks.ts` blocks `tasks.sendMessage` when `execution_state === 'failed'` (the only guard found blocks/defers on `'running'`). So the existing code already supports "user resends after a watchdog-caused failure" correctly, with no new code path — but this exact scenario (resend after `failed`, not after `waiting_user`) had no existing test coverage before this change; see Test Strategy below.

## Test Strategy

Explored during this change's design (via `openspec-explore`, no production code changes required to enable any of the following — every DI seam already exists):

**Unit — `src/bun/engine/cursor/inprocess-adapter.test.ts`** (extends existing fake-`CursorSdkClient` pattern):
- Stall watchdog fires a fatal `EngineEvent.error` when no SDK message arrives within `stallTimeoutMs` (constructed with a short override, e.g. 30-50ms, per Decision 3's constructor-injection revision — mirrors `copilot-sdk-adapter.test.ts`'s "A4" pattern).
- Timer resets on every SDK message (not just translated events) — a stream that emits messages just under the threshold repeatedly never stalls.
- Watchdog does not fire (no duplicate/conflicting error event) when the run's `AbortSignal` is triggered before the threshold elapses — reuses the existing hook-promise pattern from the "stops emitting events after abort" test.
- `run.cancel()` is best-effort called on stall, and cancel-rejecting does not prevent the fatal error yield (mirrors the existing "always cancels... even when cancel() rejects" test).
- `Cursor.configure` is called with `{ local: { useHttp1ForAgent: true } }` exactly once at module load — verified via the injected fake SDK client's `Cursor` surface (may require adding a `configure` mock to `CursorSdkClient`'s test fakes if not already present).

**Unit — `src/bun/engine/cursor/translate-events.test.ts`**:
- `case "status"` reads `message.status` (not `message.message`) for `"RUNNING"`/`"FINISHED"`/`"ERROR"`.
- Falls back to an empty string when `status` is absent, without throwing.

**Integration (real in-memory DB, full RPC) — `src/bun/test/cursor/rpc-scenarios.test.ts`**:
- Reuses existing `MockCursorSdkAdapter`'s `fatalError()` step (already proven by `§6.3.7b`) to simulate a watchdog-caused failure — no new mock step type needed, since a watchdog stall and any other fatal `EngineEvent.error` are indistinguishable from the adapter contract's perspective.
- **New scenario** (gap found during exploration, not previously covered): after a task reaches `execution_state === 'failed'` (via a fatal error), the user sends a follow-up message via `tasks.sendMessage` and a **new** execution starts successfully end-to-end (distinct from `§6.3.5b`, which covers resending after `waiting_user`, not after `failed`) — proves the actual recovery path this whole change exists to protect.

**Playwright**: none added, per decision — the only newly-exposed UI surface (`status_chunk` → status text) is covered by decision to skip Playwright coverage for it (backend unit test on `translate-events.ts` is sufficient; see decision record).

## Risks / Trade-offs

- [Risk] `useHttp1ForAgent` may not cover the exact internal call path causing the stalls (static analysis was inconclusive on this point) → Mitigation: the stall watchdog remains in the change regardless, as an unconditional backstop; if HTTP/1.1 fully resolves the root cause, the watchdog simply becomes a very-rarely-firing safety net with no downside.
- [Risk] HTTP/1.1 + SSE may have different performance characteristics (e.g. head-of-line blocking, no multiplexing) for local-agent streaming under high tool-call volume → Mitigation: this only affects the local-agent SDK's own internal streaming to Cursor's backend (not our server's HTTP stack), and Cursor's own docs recommend it as their documented fallback for exactly this kind of compatibility issue; low risk given Cursor already defaults to it for Bun runtimes per their own docs.
- [Risk] Stall threshold of 5 minutes could false-positive on legitimately slow tool calls (e.g. a long-running shell command or large repo indexing) → Mitigation: threshold resets on every SDK message (not just completed tool calls), so any streaming progress — including intermediate `tool_call` "running" status updates — resets the clock; a call that's silently making progress but not emitting any message for 5 minutes is arguably indistinguishable from a stall by definition.
- [Risk] Calling `run.cancel()` on a stalled run whose underlying transport is already broken may itself hang or throw → Mitigation: wrapped in `.catch(() => {})` exactly like the existing abort path; the fatal error yield happens regardless of whether cancel succeeds.
- [Trade-off] The watchdog only covers Cursor, per explicit decision — if another engine develops a similar SDK-internal stall bug in the future, this code isn't reusable without duplication. Accepted per decision #1091: minimal blast radius over premature generalization.

## Migration Plan

No data migration. No schema change. No API contract change. This is a pure behavior-hardening change to an existing engine, deployed as a normal code change:

1. Add `Cursor.configure(...)` call — takes effect on next process start (module-load time).
2. Add watchdog logic — takes effect for all subsequent Cursor runs.
3. Fix `translate-events.ts` — takes effect immediately, no compatibility concern (the field was always empty before; this only starts populating it correctly).
4. Rollback: revert the commit; all three changes are independent and could also be reverted individually if one caused an unexpected regression.

## Open Questions

- Should the stall threshold eventually become configurable per-workspace or per-model, given different Cursor models may have different legitimate long-tool-call profiles? Deferred — no evidence yet to justify the complexity (see Decision 3).
- Should we also patch the raw `unhandledRejection` handler in `src/bun/index.ts` to specifically recognize and structurally log this ConnectError pattern (vs. its current generic catch-all logging)? Not included in this change's Impact list — could be a fast, low-risk follow-up if the structured per-run logging (Decision 4) proves insufficient to correlate future occurrences.
