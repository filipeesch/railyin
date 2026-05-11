## Context

The Pi engine integrates the `@earendil-works/pi-coding-agent` SDK (v0.74.0). Compaction has two paths: manual (`tasks.compact` RPC → `engine.compact()` → `session.compact()`) and auto (SDK-internal `_checkCompaction()` called before each agent turn).

**Auto-compact failure root cause**: The SDK's `_checkCompaction()` calls `calculateContextTokens(assistantMessage.usage)`, which requires the LLM to return token usage in its streaming response (via `stream_options: { include_usage: true }`). Local LLMs (LM Studio, Ollama) typically do not honour this option, returning all-zero usage structs. `calculateContextTokens(zeros) = 0`, so `shouldCompact(0, ...) = false` always. Meanwhile, the context gauge uses `session.getContextUsage()` → `estimateContextTokens()`, a content-length based estimate that works regardless of LLM provider — hence the gauge grows while auto-compact never fires.

A secondary timing issue exists: the SDK fires `_runAutoCompaction` from its internal `_agentEventQueue` *after* `session.prompt()` resolves. At that point Railyin's `AsyncQueue` has already been closed (`.finally(() => queue.close())`), so any compaction events emitted would be silently dropped by `queue.push()`.

**Manual compact failure root cause**: `engine.compact()` does `this.sessions.get(conversationId)` — if the server restarted or the session was never created for this conversation (e.g., task was created offline, no execution yet), it returns `undefined` and the method silently returns. The Pi session persists conversation history to `~/.railyin/pi-sessions/<hash>.jsonl`; the session can be fully restored from that file.

**Post-compact feedback gap**: After `session.compact()` succeeds, `engine.compact()` appends a `compaction_summary` row to the DB but emits no WebSocket event. The frontend never learns the summary was added, and context usage in the gauge stays at its pre-compaction level.

**Existing stream-processor bug**: The `compaction_done` handler in `stream-processor.ts` creates `compaction_summary` messages with `content: ""` — it never reads `event.summary` even though the `EngineEvent` type carries it and `translateEvent` correctly populates it.

## Goals / Non-Goals

**Goals:**
- Auto-compact fires reliably for local LLMs using the content-estimate threshold
- Manual compact works even when no live Pi session is in memory
- Concurrent compact calls are rejected gracefully
- After manual compact: summary appears in the conversation timeline and gauge drops without page refresh
- `compaction_done` stream-processor path uses the actual summary text

**Non-Goals:**
- Changing the Pi SDK internals or the compaction prompt
- Supporting compaction for engines other than Pi (Copilot, Claude use their own mechanisms)
- Persisting the auto-compact summary separately (SDK handles this in the `.jsonl` file)
- Any UI changes beyond triggering an existing re-fetch

## Decisions

### 1. Post-execution auto-compact in `.then()`, not as a separate SDK hook

**Decision**: Implement auto-compact in a `.then()` callback chained on `session.prompt()`, *before* the `.finally(() => queue.close())` call.

**Rationale**: `.then()` executes synchronously before `.finally()` in Promise chain order. This guarantees the `AsyncQueue` is still open when `session.compact()` emits its `compaction_start`/`compaction_end` events through the subscriber. Hooking into the SDK's internal `_checkCompaction` mechanism is not possible without patching the SDK.

**Alternative considered**: Spawn a separate background task after the execution stream closes. Rejected: events would be emitted after `unsubscribe()`, requiring a new subscriber — significantly more complex and not needed.

**Threshold**: Use `session.getContextUsage().tokens > piModel.contextWindow - DEFAULT_RESERVE_TOKENS` (16384 tokens reserved, matching SDK default). Add a `DEFAULT_RESERVE_TOKENS = 16_384` constant.

### 2. Session restoration via `getOrCreateSession()` in `compact()`

**Decision**: When `compact()` finds no live session, call `getOrCreateSession(conversationId, this.buildModel(), [], undefined, workingDirectory)` to restore from the persisted `.jsonl`.

**Rationale**: `getOrCreateSession` already handles both cases: if the `.jsonl` exists, `SessionManager.open(sessionPath)` loads the full branch history and the SDK compacts from it; if the file is absent, `session.compact()` throws `"Nothing to compact"` which is caught and logged. Passing `tools: []` is safe because `session.compact()` never invokes tools — it makes a direct LLM call over the session history. The session is stored in `this.sessions` after creation, so a subsequent execution will find it and overwrite tools/model/systemPrompt via `getOrCreateSession`'s update-existing path.

**Alternative considered**: Accept full `ExecutionParams` in `compact()` to create a "proper" session. Rejected: `compact()` is called from `orchestrator.compactTask()` which has no `ExecutionParams`, and this data is immediately overwritten by the next `execute()` call anyway.

### 3. Post-compact feedback via orchestrator broadcast

**Decision**: After `engine.compact()` returns, `orchestrator.compactTask()` / `compactConversation()` queries the last `compaction_summary` row from `conversation_messages` and calls `this.onNewMessage()` to broadcast it.

**Rationale**: `engine.compact()` has access to `getDb()` and already appends to DB, but has no WebSocket handle. The orchestrator already holds `this.onNewMessage` (a `NotificationService` callback). Keeping the broadcast in the orchestrator respects the existing separation: engines write to DB, orchestrators broadcast.

**Frontend side**: The `conversation.ts` store already handles `message.new` to append messages. Adding a `fetchContextUsage()` call when the received message type is `compaction_summary` is a minimal addition in the existing `onNewMessage` handler.

### 4. `isCompacting` guard throws, not silently skips

**Decision**: Throw `new Error("Compaction already in progress")` when `session.isCompacting` is true.

**Rationale**: A silent skip would leave the user confused (button appeared to do nothing). The orchestrator propagates the throw as an HTTP 500 to the RPC caller, which the frontend already surfaces as a toast. This is the correct user-visible feedback.

## Risks / Trade-offs

- **[Risk] Auto-compact fires after every execution when near threshold**: A model that stays near the threshold will compact after every turn. → Mitigation: The `!session.isCompacting` guard prevents concurrent calls. Post-compaction the token estimate drops, so subsequent turns won't immediately re-trigger. Acceptable behaviour.

- **[Risk] Auto-compact events appear in closed stream if `.then()` takes too long**: If the LLM call in `session.compact()` takes a long time and the consumer of the async generator has already returned, events could be emitted to a garbage-collected queue. → Mitigation: The `AsyncQueue` holds a reference chain until the generator's `finally` block runs; `unsubscribe()` is in that `finally` block. As long as the promise chain resolves before `unsubscribe()` is called, this is safe. The `.then()` → `.catch()` → `.finally()` order guarantees this.

- **[Risk] `compaction_done` fix changes stored message content for auto-compact path**: Previously stored as `""`, now stored as the actual summary. → This is the correct fix; the empty string was a latent bug. No migration needed — old empty messages are historical records.

## Migration Plan

No DB migration required. No new RPC types. No new WebSocket event types. No breaking API changes.

Deploy as a standard server restart. Sessions in `~/.railyin/pi-sessions/` are unaffected.

## Open Questions

- None. All decisions were resolved during the exploration phase.
