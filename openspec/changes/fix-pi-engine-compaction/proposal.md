## Why

When background compaction fires during an active Pi execution, it internally calls `session.abort()`, which causes `session.prompt()` to resolve early. The `.finally(() => queue.close())` in `runPromptWithCompaction` then closes the `AsyncQueue` immediately, marking the conversation as Done — even though the agent wasn't finished. A secondary bug exists for SDK overflow auto-compaction: `_runAutoCompaction("overflow", willRetry=true)` executes asynchronously after `session.prompt()` returns and defers `agent.continue()` by 100ms via `setTimeout`; by then, the queue is already closed, so all recovery events and the continuation are silently lost.

## What Changes

- `runPromptWithCompaction` becomes a thin shell delegating to a new private `runWithCompactionResume()` helper that wraps `session.prompt()` / `session.agent.continue()` in a while-loop, keeping the queue open until the agent truly finishes.
- `SettingsManager.inMemory` is changed to `compaction: { enabled: false }` so the SDK never fires its own threshold-based auto-compaction (we own the full lifecycle). Manual `session.compact()` and overflow auto-compaction are unaffected.
- The `session.subscribe()` callback gains a `sdkWillRetryRef` flag to detect SDK overflow compaction (`compaction_end.willRetry === true`), which the loop uses to wait for the SDK's deferred `agent.continue()` instead of calling it ourselves.
- A private `waitForNextAgentEnd()` helper subscribes to the next `agent_end` event from the session — used only for the overflow retry path.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities

- `pi-engine-parallelism`: The background compaction requirement must be updated. `session.compact()` internally aborts the active prompt; the execution loop must await the in-flight compaction before resuming rather than treating the early prompt resolution as a completion. The "fire-and-forget" semantics of background compaction are preserved — the loop detects the abort after the fact by checking `bgCompactions.get(conversationId)`.
- `conversation-compaction`: The SDK overflow auto-compaction lifecycle scenario must be updated. The Pi engine now handles the overflow retry path by detecting `compaction_end.willRetry` and waiting for the SDK's own `agent.continue()` to complete rather than calling it itself. The SDK threshold auto-compaction (`enabled: true` in SettingsManager) is replaced by the engine's own `turn_end`-based background compaction.

## Impact

- **Code**: `src/bun/engine/pi/engine.ts` — the only production file that changes.
- **Tests**: New `src/bun/test/pi/compaction-resume.test.ts` (7 cases: CR-1..CR-7); two additions to `background-compaction.test.ts` (BC-6, BC-7). All via `MockResumingSession` — no production code changes needed to support testing.
- **Behavior**: Conversations no longer terminate prematurely when background compaction fires mid-execution. SDK overflow contexts now recover correctly.
- **No API/RPC changes**: This is purely internal execution loop behavior.
- **No new dependencies**: `isContextOverflow` is already exported from `@earendil-works/pi-ai` (already imported).
