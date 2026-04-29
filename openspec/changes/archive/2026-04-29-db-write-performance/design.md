## Context

The Railyn Bun backend uses a single SQLite database in WAL mode. SQLite WAL allows unlimited concurrent readers but only one writer at a time. When multiple AI sessions run in parallel, each streaming response generates hundreds of individual autocommit INSERTs (one per token for `conversation_messages`, one per raw event for `model_raw_messages`, plus a DELETE on every raw write). Each autocommit is a full WAL flush, causing write lock contention that manifests as board rendering slowness, chat load latency, and UI lag during active AI runs.

Additionally, `StreamBatcher` (which batches `stream_events`) has been superseded: the WS broadcast in `index.ts` already happens synchronously before `batcher.push()`, so `StreamBatcher`'s `onFlush` callback is a no-op. Its only remaining value is enriching events with `blockId`/`seq` and batching the `stream_events` DB write — two distinct concerns that should be separated.

## Goals / Non-Goals

**Goals:**
- Reduce WAL flush count from O(tokens) to O(tool-turns) per streaming response
- Extract a generic `WriteBuffer<T>` primitive reusable across all hot write paths
- Replace `StreamBatcher` with `WriteBuffer` + a pure `StreamEventEnricher`
- Add `ConvMessageBuffer` and `RawMessageBuffer` on the same primitive
- Remove inline `DELETE` from the hot path; replace with a `RetentionJob` background timer
- Extract `PositionService` to collapse N-UPDATE loops into single `db.transaction()` calls
- Fix `tasks.list` correlated subquery; wrap `tasks.delete` in a transaction
- Consolidate `estimateContextUsage` / `estimateConversationContextUsage`; fix broken slow path
- Thread `Database` via DI from `index.ts` through all executors and handlers
- Add migration `032` with compound indices on `executions` and `tasks`

**Non-Goals:**
- Switching from SQLite to a multi-writer database
- Connection pooling (not applicable to in-process SQLite)
- Frontend changes
- API contract changes
- Test suite changes in this change (separate concern)

## Decisions

### D1: Generic `WriteBuffer<T>` as the single batching primitive

**Decision**: Hot DB write paths for `stream_events` and `model_raw_messages` share one generic `WriteBuffer<T>` class with timer-based flushing. `ConvMessageBuffer` is a sibling primitive with boundary-triggered flushing only (see D3a).

**Rationale**: `StreamBatcher` already proved the pattern. The buffer mechanics (in-memory queue, count threshold, interval timer, manual flush, stop/drain) are identical across the two timer-based paths. Extracting them into a generic eliminates duplication and makes each domain-specific buffer a thin wrapper: constructor + injected `flushFn`. `flush()` returns `T[]` — the items that were written — so callers can react to persisted data (e.g. fire `onNewMessage` after a `ConvMessageBuffer` flush).

**Alternative considered**: Three bespoke buffer classes with copy-pasted internals. Rejected — harder to test, harder to tune uniformly.

```
WriteBuffer<T>
  constructor({ maxBatch?, intervalMs?, flushFn: (items: T[]) => void, waitFn?: WaitFn })
  enqueue(item: T): void   // adds to buffer; auto-flushes at maxBatch
  flush(): T[]             // drain → flushFn → clear; returns flushed items
  start(): void            // start interval loop
  stop(): void             // set running=false + tick() + final flush
```

**Timer injection (testability)**: The interval loop uses an injected `WaitFn = (ms: number) => Promise<void>`. Production uses `(ms) => new Promise(r => setTimeout(r, ms))`. Tests inject a `createMockWait()` helper (from `test/support/mock-wait.ts`) that exposes a `tick()` function to resolve the pending wait on demand — deterministic, no `sleep()`, no flakiness. `stop()` internally calls `tick()` to unblock the loop immediately, so test cleanup is always just `buf.stop()`.

---

### D2: `StreamBatcher` → `WriteBuffer` + `StreamEventEnricher`

**Decision**: Delete `StreamBatcher`. Replace with:
- `StreamEventEnricher` — pure stateful class: assigns `blockId` (by type/counter) and `seq` numbers; has no I/O
- `WriteBuffer<PersistedStreamEvent>` — injects `appendStreamEventBatch` as `flushFn`

**Rationale**: `StreamBatcher` mixes three concerns (event enrichment, buffering mechanics, DB write). Separation makes each testable in isolation. The `onFlush` callback that `index.ts` registers is already empty — the WS broadcast happens before `batcher.push()`. There is no streaming UX regression: the pipeline is already:

```
engine event → broadcast (WS, immediate) → enrich → WriteBuffer → DB (batched)
```

**Alternative considered**: Keep `StreamBatcher`, have it delegate buffer internals to `WriteBuffer`. Rejected — still couples enrichment to buffering; the empty `onFlush` callback remains confusing.

---

### D3: `db.transaction()` for all buffer flushes — NOT raw `BEGIN`/`COMMIT`

**Decision**: All buffer flush functions use `db.transaction(fn)()` — the native bun:sqlite API.

**Rationale**: `db.transaction()` auto-wraps with `BEGIN` → `COMMIT` on success, `ROLLBACK` on exception. It prepares the transaction function once and reuses it. Raw `db.run("BEGIN")` is lower-level, error-prone, and not the idiomatic bun:sqlite pattern. The existing `appendStreamEventBatch` already uses `db.transaction()()` correctly — all new flush functions follow the same pattern.

### D3a: `ConvMessageBuffer` — boundary-triggered, NOT a `WriteBuffer` subclass

**Decision**: `ConvMessageBuffer` is a standalone class with no interval timer. It accumulates pending messages and exposes `flush()`, called explicitly by `StreamProcessor` at tool boundaries and execution end.

**Rationale**: `conversation_messages` carries the permanent message history. `onNewMessage` must fire at the same logical boundary as today (tool_call, tool_result, done) — not on a 500ms timer — to keep the message sidebar responsive. Since `ConvMessageBuffer` has no timer, it requires no `WaitFn` injection and no `start()`/`stop()` lifecycle. Tests call `flush()` directly.

**Flush internals**: A single `db.transaction()` loop, one `INSERT INTO conversation_messages ... RETURNING id` per pending message. IDs are collected in insertion order. `flush()` returns the inserted rows. `StreamProcessor` then calls `onNewMessage(row)` for each returned row — `StreamProcessor` owns the notification side-effect; `ConvMessageBuffer` is pure persistence. This preserves the existing N-per-boundary `onNewMessage` contract exactly.

---

### D4: Flush triggers — tool boundaries + execution end

**Decision**: `StreamProcessor.consume()` calls `.flush()` on all three buffers at the same points:
- `tool_call` boundary (engine pauses waiting for tool execution)
- `tool_result` complete
- `done` / `error` / `cancel` (execution end)

**Rationale**: Tool boundaries are natural pause points where the engine is not producing tokens. Flushing there amortizes WAL flushes to O(tool-turns) per response. A 150-token response with 3 tool calls = 3 WAL flushes instead of ~150. The 500ms interval timer on `WriteBuffer` is a safety net for token-only responses with no tool calls.

---

### D5: Full DI — `Database` injected everywhere

**Decision**: `getDb()` is called exactly once in `index.ts`. The `Database` instance is threaded as a constructor argument into all executors and as the first argument to all handler factories.

**Rationale**: The service-locator pattern (`getDb()` called inline throughout) makes testing harder (requires env var to swap DB) and makes dependencies implicit. Executor classes already have constructors; handler factories already accept arguments. The change is mechanical but makes all DB dependencies explicit and testable with an in-memory `Database` passed directly.

**DI graph:**
```
index.ts: const db = getDb()
  ├─ new Orchestrator(db, ...)
  │    ├─ new StreamProcessor(db, convBuffer, rawBuffer, ...)
  │    ├─ new TransitionExecutor(db, ...)
  │    ├─ new HumanTurnExecutor(db, ...)
  │    ├─ new RetryExecutor(db, ...)
  │    ├─ new ChatExecutor(db, ...)
  │    └─ new CodeReviewExecutor(db, ...)
  ├─ taskHandlers(db, orchestrator, ...)
  ├─ boardHandlers(db)
  ├─ conversationHandlers(db, orchestrator)
  └─ chatSessionHandlers(db, ...)
```

---

### D6: `ContextEstimator` — compaction-anchored slow path, unified on `conversation_id`

**Decision**: Consolidate `estimateContextUsage` (task-based) and `estimateConversationContextUsage` (chat-session-based) into a single `ContextEstimator` service with one method: `estimate(conversationId, maxTokens)`. All tables (`executions`, `conversation_messages`) have `conversation_id`, so the task-id axis is unnecessary. Fix the slow path to:
1. Find the last `compaction_summary` message for the conversation
2. Load only messages after that anchor, `LIMIT 200`
3. Estimate = type-weighted char heuristic (tool messages: `chars/3.5`; others: `chars/4`) + `SYSTEM_MESSAGE_OVERHEAD_TOKENS`

**Rationale**: The current slow path loads ALL `conversation_messages` and runs an in-memory `compactMessages()` pass. The compaction summary already represents the compressed history — there is no reason to re-process it. Anchoring on the last compaction message is both more accurate and dramatically cheaper. Both near-duplicate functions differ only in lookup column — `conversation_id` is available in both contexts and unifies the implementation into a single code path.

---

### D7: `RetentionJob` as a background timer

**Decision**: Remove `DELETE FROM model_raw_messages WHERE created_at < datetime('now', '-1 day')` from `_persistRawModelMessage`. Replace with a `RetentionJob` that runs on startup (after migrations) and then every 5 minutes. Retention policy:
- `model_raw_messages`: delete rows older than **1 day**
- `stream_events`: delete rows older than **4 hours**

**Rationale**: The inline DELETE runs on every single raw message write — potentially hundreds of times per response. It is a maintenance operation that does not need to be synchronous with writes. The pattern already exists: `startChatSessionAutoArchiveJob` in `index.ts` runs an hourly cleanup. `RetentionJob` follows the same structure.

`stream_events` are only needed for WebSocket reconnect replay. After 4 hours any active execution has long since completed and `conversation_messages` holds the permanent record. 4 hours reduces the `stream_events` table size ~40× vs the previous 7-day policy, making the `getStreamEventsByConversation` query significantly faster.

**Timer injection (testability)**: Same `WaitFn` pattern as `WriteBuffer`. `RetentionJob.start()` calls `runNow()` immediately on startup (no initial wait), then loops `await waitFn(5min)` → `runNow()`. Tests call `runNow()` directly or inject a `createMockWait()` to control the loop.

---

### D8: `PositionService` for transactional position management

**Decision**: Extract `rebalanceColumnPositions` and `reorderColumn` from `tasks.ts` into a `PositionService`. Wrap all N-UPDATE loops in `db.transaction()`.

**Rationale**: Position rebalancing fires N individual autocommit UPDATEs (one per task in the column). For a column with 20 tasks, that is 20 WAL flushes for a single user action. A `db.transaction()` wrapper collapses these to 1. Extraction also removes the only non-query business logic from the handler file.

## Risks / Trade-offs

**[Risk] Buffered `conversation_messages` — delayed `onNewMessage` IDs** → Not a risk: `ConvMessageBuffer` is boundary-triggered (no timer), so `onNewMessage` fires at the exact same logical moment as today (tool_call, tool_result, done). The only change is that N INSERTs are wrapped in one transaction instead of being individual autocommits. The callback contract and timing are preserved.

**[Risk] Open transaction leaking on unhandled exception** → `db.transaction()` automatically rolls back on exception. `WriteBuffer.stop()` must be called in the `finally` block of `StreamProcessor.consume()` to ensure the final flush attempt always runs.

**[Risk] DI threading is a large mechanical change** → Risk of merge conflicts and missed call sites. Mitigation: update `getDb()` to log a warning if called outside `index.ts` / migrations context (can be removed after stabilisation).

**[Risk] `StreamBatcher` deletion** → If any code path relies on the `onFlush` callback, removing `StreamBatcher` would break it. Mitigation: the `onFlush` callback in `index.ts` is already a documented no-op; `batcher.push()` is the only call site.

**[Trade-off] `WriteBuffer` timer adds a dependency on `setInterval`** → Timer is injected via `WaitFn` constructor argument; `createMockWait()` in `test/support/mock-wait.ts` provides a controllable replacement. No `setInterval` used directly in production — the real `WaitFn` wraps `setTimeout` per tick. Fully testable without fake clocks or `sleep()`.

## Migration Plan

1. Add migration `032_perf_indices.ts` — compound indices only; no data changes; safe to run on any database size
2. Deploy updated Bun process — in-process change, no server restart required beyond normal redeploy
3. Rollback: revert commit; the old `getDb()` singleton is unchanged, migration indices are additive and harmless if left

---

### D9: Broadcast-first via `WriteBuffer.onEnqueue` — text_chunk and reasoning_chunk hot path

**Problem (post-implementation discovery)**: After implementing `WriteBuffer` with async flush, token delivery remained bursty. Root cause: the adapter IIFE fills the generator queue with all tokens from a single TCP packet instantly (array push, ~1μs each). The generator's inner `while (queue.length > 0)` drains them all in one tight loop before the event loop can flush any WS frames. A `setImmediate` hack between tokens in `consume()` was attempted and failed because `setImmediate` fires in the "check" phase before I/O — uWS still coalesces frames buffered in the same event-loop turn.

**Decision**: Add `onEnqueue?: (item: T) => void` to `WriteBuffer<T>`. The callback fires **synchronously, before `pending.push()`** in `enqueue()`. For `rawBuffer`, this callback detects text_delta / thinking_delta raw messages, enriches them (seq/blockId) via the per-execution `StreamEventEnricher`, and calls `broadcast()` immediately — in the IIFE's execution context, before any generator queue involvement.

`consume()` no longer calls `onStreamEvent` for `text_chunk` or `reasoning_chunk` events (they are already broadcast). The `setImmediate` hack in `consume()` case "token" is removed. The `setImmediate` in `_loop()` is also removed — the broadcast is fully decoupled from DB flush by construction.

**Architecture after D9:**
```
Claude SDK message arrives (I/O callback):
  IIFE:
    onRawMessage() → makePersistCallback() →
      rawBuffer.enqueue():
        ┌─ onEnqueue callback (synchronous) ─────────────────────┐
        │  if text_delta:  enrich("text_chunk") → broadcast()    │  ← immediate WS send
        │  if thinking_delta: enrich("reasoning_chunk") → broadcast()│
        └────────────────────────────────────────────────────────┘
        pending.push(item)    ← DB write deferred to _loop() flush

    translateClaudeMessage() → emit(token/reasoning event)

Generator / consume():
  case "token":    → onToken() only — no onStreamEvent (already broadcast above)
  case "reasoning": → onToken() only — no onStreamEvent (already broadcast above)
  case "tool_start": → onStreamEvent("tool_call") → enrich + broadcast + DB
  case "done":       → onStreamEvent("done")       → enrich + broadcast + DB
  ... (all non-token events unchanged)
```

**Seq/blockId consistency**: The `StreamEventEnricher` is called in the IIFE context for text/reasoning chunks, and in `consume()` for all other event types. Since raw messages arrive (and fire `onEnqueue`) BEFORE their corresponding EngineEvents are emitted to the generator queue, the enricher sees events in the correct arrival order. Tool events (tool_call, tool_result) and done events continue through `onStreamEvent` with seq numbers that follow the token chunks.

**`onEnqueue` wiring**: `index.ts` creates the callback (which closes over `enrichers` map and `broadcast()`), passes it to `Orchestrator` constructor as `onRawMessageEnqueued`, which forwards it to `createRawMessageBuffer`. Engine-specific format detection (`eventType === "stream_event"`, `event.delta.type === "text_delta"`) is isolated in this callback. Copilot does not use `onRawMessage` and is unaffected.

**`RawMessageItem`**: Gains a `conversationId` field so the broadcast callback can produce a complete `StreamEvent` without additional DB lookups.

**Prepared statement**: `createRawMessageBuffer` now prepares the INSERT statement once at construction time and reuses it across flushes, avoiding per-flush statement compilation overhead.

**Alternative considered**: Inserting a `setTimeout(0)` or `setImmediate` between generator yields. Rejected — does not solve the uWS frame coalescing issue and introduces non-deterministic test behavior.

---

## Open Questions

- Should `WriteBuffer` expose a `size()` method for observability/metrics? (Nice to have, not required)
- Should `ContextEstimator` cache the last result per task with a short TTL to avoid repeated calls during a single frontend poll cycle? (Deferred — measure first)
