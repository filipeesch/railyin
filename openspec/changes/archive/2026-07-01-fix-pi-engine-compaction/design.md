## Context

The Pi engine wraps `session.prompt()` in a fire-and-forget function (`runPromptWithCompaction`) whose `.finally()` closes the `AsyncQueue` that feeds the execution event stream. This worked when compaction was always post-prompt (`.then()` chain), but broke when background compaction was introduced: `session.compact()` calls `session.abort()` internally, which resolves `session.prompt()` early, triggering the `finally` before the agent is actually done. A secondary bug affects the SDK's overflow auto-compaction path, which defers `agent.continue()` via `setTimeout(..., 100)` after the queue is already closed.

The only file affected is `src/bun/engine/pi/engine.ts`.

## Goals / Non-Goals

**Goals:**
- Keep the `AsyncQueue` open for the entire lifetime of an agent run, including compaction pauses and SDK-driven retries.
- Fix both bugs in a single, coherent change to `engine.ts`.
- Preserve all existing behaviors: limiter accounting, `bgCompactions` map, `compaction_start`/`compaction_done` event flow, manual compact, delegate, signal abort.

**Non-Goals:**
- Changes to any file other than `engine.ts` and the Pi test files listed in the Testing Design section.
- Changes to the `AsyncQueue`, `event-translator`, `provider-transport`, or any shared type.

## Decisions

### 1. Loop in a private helper, not inline

Extract `runWithCompactionResume()` as a private method instead of expanding `runPromptWithCompaction` in place. `runPromptWithCompaction` becomes a 4-line shell that calls the helper and wires `.catch` / `.finally`. This matches the project's existing pattern of small, focused private methods and avoids further inflating an already-complex function.

*Alternatives considered*: Inline loop — rejected because it would make `runPromptWithCompaction` hard to unit-test and understand in isolation.

### 2. Disable SDK threshold auto-compaction (`enabled: false`)

Change `SettingsManager.inMemory({ compaction: { enabled: false } })`. The SDK's threshold check (`_checkCompaction`) fires asynchronously in `_agentEventQueue`; if we left it enabled, it could race with our own `turn_end`-triggered `session.compact()`, causing two concurrent compactions. Setting `enabled: false` gives us full ownership of the compaction lifecycle. `reserveTokens` and `keepRecentTokens` still apply to every `session.compact()` call — the `enabled` flag only gates the auto-trigger.

*Alternatives considered*: Keep `enabled: true` + poll `session.isCompacting` — rejected because polling is fragile (the `_agentEventQueue` may not have started the compaction yet when we check) and introduces unnecessary latency on every turn.

### 3. Overflow detection via `compaction_end.willRetry` event

Track `sdkWillRetryRef = { value: false }` (a closure ref, like `errorRef`) inside `createManagedExecution`. The subscriber sets it to `true` when it sees a `compaction_end` event with `!event.aborted && event.willRetry`. The loop reads and resets it each iteration.

This is the only reliable signal: `isContextOverflow()` from `@earendil-works/pi-ai` requires the raw assistant message (not available post-prompt), and `session.isCompacting` may still be `false` immediately after `session.prompt()` returns (the async queue hasn't started `_runAutoCompaction` yet).

*Alternatives considered*: Import and call `isContextOverflow()` after prompt — rejected (message not available); poll `session.isCompacting` — rejected (race window, latency).

### 4. Wait for SDK's overflow retry via `waitForNextAgentEnd()`

When `sdkWillRetryRef.value` is true, the SDK has already scheduled `setTimeout(() => agent.continue(), 100)`. We must NOT call `agent.continue()` ourselves (double-call throws). Instead, subscribe to the next `agent_end` event and await it. The SDK's deferred call fires, runs a full turn, and emits `agent_end`. We pick up from there with the next loop iteration.

```ts
private async waitForNextAgentEnd(session: AgentSession): Promise<void> {
  await new Promise<void>((resolve) => {
    const unsub = session.subscribe((evt) => {
      if (evt.type === "agent_end") { unsub(); resolve(); }
    });
  });
}
```

*Alternatives considered*: `session.agent.waitForIdle()` — not available in the typed interface; `setTimeout(150)` buffer — fragile, model-speed-dependent.

### 5. Post-bgCompaction break condition: check last message role

After `await bgCompaction`, inspect `session.agent.state.messages.at(-1)?.role`:
- `=== "assistant"` → the agent completed its turn before being aborted (compact fired at turn boundary). Loop exits — we're done.
- `!== "assistant"` (typically `toolResult` or `user`) → the agent was mid-turn when aborted. Loop continues: call `agent.continue()` next iteration.

This avoids calling `agent.continue()` when the last message is already an assistant message (which throws).

### 6. `sdkWillRetryRef` shared via closure (not class field)

Consistent with `errorRef` and `suspendedForDecision` already in `createManagedExecution`. Adding class-level state for execution-scoped concerns would widen `PiEngine`'s responsibilities and require explicit cleanup.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| SDK changes `_runAutoCompaction` internals in a future version | `compaction_end.willRetry` is a stable public event field. Even if SDK internals change, our event-driven approach remains correct. |
| `waitForNextAgentEnd` resolves prematurely if a background operation emits `agent_end` | Background compactions in the Pi SDK do not emit `agent_end` (only `compaction_start`/`compaction_end`). Only `runAgentLoopContinue` emits `agent_end`. |
| Agent loop runs indefinitely if overflow compaction keeps failing | SDK guards this with `_overflowRecoveryAttempted`: after one failed overflow compact-and-retry, it emits `compaction_end { willRetry: false }` and stops. Our loop then falls through to the normal break. |
| `enabled: false` surprises future developers | The comment on `SettingsManager.inMemory` will explain that threshold auto-compaction is managed by our `turn_end` handler. |

## Migration Plan

No migration required. This is an internal execution loop fix. No database schema changes, no RPC changes, no configuration format changes. Deploy is a normal server restart.

Rollback: revert the single commit to `engine.ts`.

## Testing Design

### Scope

All tests live in `src/bun/test/pi/`. No Playwright specs or frontend unit tests are needed: `compaction_start`/`compaction_done` are internal `EngineEvent` types consumed by `stream-processor.ts` and emitted as `message.new` WS pushes — the existing `extended-chat.spec.ts` Suite R tests already cover `msg--compaction` rendering end-to-end.

### New Mock: `MockResumingSession`

Extends the existing `MockBgSession` pattern (session factory injection via `PiEngine` 7th constructor param). Adds:

- **`agent.continue()`** — a spy stub; resolves once; tracked via `continueCallCount`
- **`agent.state.messages`** — settable array; default `[{ role: "user" }]` (non-assistant → triggers `continue()` path); can be set to `[{ role: "assistant" }]` for break-immediately path
- **`prompt()` abort mode** — an `abortMidTurn: boolean` option; when true, fires `turn_end` (triggering the BG compaction branch), resolves immediately (simulating `session.abort()` cutting `session.prompt()` short), and does NOT set `messages.at(-1).role` to `"assistant"`
- **`subscribe()` willRetry mode** — can fire `{ type: "compaction_end", willRetry: true }` before resolving to simulate SDK overflow retry

No production code changes are needed to support this mock — the session factory injection point already exists.

### New File: `src/bun/test/pi/compaction-resume.test.ts`

| ID | Scenario | Key assertion |
|----|----------|---------------|
| **CR-1** | BG compaction fires → `prompt()` resolves early → queue stays open → `agent.continue()` is called | `continueCallCount === 1`; no `done` event emitted prematurely; execution completes after `continue()` |
| **CR-2** | After BG compaction, last message is `role: "assistant"` → `agent.continue()` NOT called, break | `continueCallCount === 0`; execution completes normally |
| **CR-3** | Two turns both exceed threshold → two BG compactions → two `continue()` calls | `compactCallCount === 2`; `continueCallCount === 2` |
| **CR-4** | `agent.continue()` throws → error propagated via `errorRef` | `errorRef.error` is set; queue closes; no unhandled rejection |
| **CR-5** | `agent.continue()` is wrapped in `runWithLimiter` | Mock the registry; verify `acquire` called before and `release` called after `continue()` |
| **CR-6** | `subscribe()` emits `compaction_end { willRetry: true }` → `sdkWillRetryRef.value` becomes `true` → loop awaits SDK's own `agent.continue()` (via `waitForNextAgentEnd`) rather than calling it itself | `continueCallCount === 0` (our code doesn't call it); `waitForNextAgentEnd` resolves when `agent_end` fires |
| **CR-7** | `compaction_end { willRetry: false }` (overflow recovery exhausted) → treated as normal completion, not as a retry signal | `sdkWillRetryRef.value === false`; loop breaks normally |

### Additions to `background-compaction.test.ts`

| ID | Scenario | Key assertion |
|----|----------|---------------|
| **BC-6** | BG compaction fires mid-execution → `AsyncQueue` is NOT closed before `agent.continue()` completes | Collect all events via `for await`; no `done` event arrives until after `continueCallCount === 1` |
| **BC-7** | After BG compaction, token count drops below threshold on next turn → no second compaction triggered | `compactCallCount === 1` even across two turns |

### DI notes

- `bgCompactions` is a private `Map`; accessible in tests via `(engine as any).bgCompactions` to inspect / pre-seed without going through the full `turn_end` trigger — useful for CR-1/CR-2 isolation.
- `MockRegistry` (already used in BC-4) provides the concurrency limiter stub for CR-5.
- No alternative test paths are introduced — all assertions are injectable via the session factory.

## Open Questions

None — all design decisions were made during the exploration phase.
