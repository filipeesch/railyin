## Why

The Pi engine's conversation compaction is broken in two ways: auto-compact never fires because the SDK relies on LLM-reported token usage (which local models like LM Studio don't return), and manual compact silently skips if the engine session was not alive (e.g., after a server restart). These issues leave users stuck with full context windows and no way to reclaim space without a workaround.

## What Changes

- **Auto-compact**: Replace the SDK's usage-based check (unreliable with local LLMs) with a post-execution check using `session.getContextUsage()` (content-based estimate, always works). Fires inside `.then()` before `.finally(() => queue.close())` so emitted events flow through the open queue.
- **Manual compact — session restoration**: When `compact()` is called and no live session exists, restore it via `getOrCreateSession()` from the persisted `.jsonl` file instead of silently skipping.
- **Manual compact — `isCompacting` guard**: Check `session.isCompacting` before calling `session.compact()` to prevent SDK crashes from concurrent calls; throw a user-friendly error.
- **Manual compact — post-compact feedback**: After `session.compact()` succeeds, broadcast `message.new` with the new `compaction_summary` so it appears in the UI immediately, then re-fetch context usage so the gauge drops.
- **Bug fix**: `stream-processor.ts` creates `compaction_summary` messages with `content: ""` (ignores `event.summary`). Fix to use the actual summary text.

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `conversation-compaction`: Auto-compact mechanism changes (estimate-based check instead of SDK usage check). Session restoration for manual compact. `isCompacting` guard. Post-compact `message.new` broadcast. `stream-processor` compaction_done bug fix.
- `context-gauge`: Gauge now drops immediately after manual compact via post-compact usage re-fetch triggered by the `compaction_summary` message broadcast.
- `pi-engine`: `compact()` method now restores session from disk when not alive, and guards against concurrent compaction.

## Impact

- `src/bun/engine/pi/engine.ts` — post-execution auto-compact logic, session restoration in `compact()`, `isCompacting` guard; `getOrCreateSession` visibility changed from `private` to `protected` (required by companion test suite `fix-pi-compaction-tests`)
- `src/bun/engine/stream/stream-processor.ts` — fix empty `compaction_summary` content
- `src/bun/engine/orchestrator.ts` — broadcast `message.new` + re-fetch usage after `compactTask()`/`compactConversation()`
- `src/mainview/stores/conversation.ts` — trigger `fetchContextUsage()` when `message.new` carries a `compaction_summary`
- No DB migrations, no new RPC types, no new WebSocket event types
