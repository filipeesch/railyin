## 1. Migration

- [ ] 1.1 Create `src/bun/db/migrations/032_perf_indices.ts` — add compound index `executions(task_id, status, input_tokens)` and `tasks(board_id, workflow_state)`

## 2. WriteBuffer primitive

- [ ] 2.1 Create `src/bun/pipeline/write-buffer.ts` — implement `WriteBuffer<T>` with `{ maxBatch?, intervalMs?, flushFn }` constructor, `enqueue`, `flush`, `start`, `stop`
- [ ] 2.2 Write unit tests for `WriteBuffer` (count-threshold flush, interval flush, manual flush, empty flush no-op, stop drains remaining)

## 3. StreamEventEnricher + stream_events buffer

- [ ] 3.1 Create `src/bun/pipeline/stream-event-enricher.ts` — pure stateful class that assigns `blockId` (by type/counter) and monotonically increasing `seq` numbers; extract logic from `StreamBatcher`
- [ ] 3.2 In `index.ts`, replace `StreamBatcher` usage with `StreamEventEnricher` + `WriteBuffer<PersistedStreamEvent>` (inject `appendStreamEventBatch` as `flushFn`, intervalMs: 500)
- [ ] 3.3 Delete `src/bun/pipeline/batcher.ts` (`StreamBatcher`) after verifying no remaining imports

## 4. ConvMessageBuffer

- [ ] 4.1 Create `src/bun/conversation/conv-message-buffer.ts` — standalone boundary-triggered accumulator (NOT a `WriteBuffer` subclass, no timer, no `start()`/`stop()`); `enqueue(msg)` accumulates pending rows; `flush()` wraps all pending inserts in a single `db.transaction()` with `INSERT INTO conversation_messages ... RETURNING id` and returns the inserted `ConversationMessage[]`; `StreamProcessor` iterates the returned rows and calls `onNewMessage(row)` for each, preserving existing callback timing
- [ ] 4.2 Update `appendMessage` in `src/bun/conversation/messages.ts` to accept an optional buffer instance; when buffer is provided, enqueue instead of direct INSERT

## 5. RawMessageBuffer

- [ ] 5.1 Create `src/bun/engine/stream/raw-message-buffer.ts` — `WriteBuffer<RawModelMessage>` with `maxBatch: 50`, flush via `db.transaction()` batch INSERT into `model_raw_messages`
- [ ] 5.2 Remove the inline `DELETE FROM model_raw_messages` from `StreamProcessor._persistRawModelMessage`; route all raw message writes through `RawMessageBuffer`

## 6. RetentionJob

- [ ] 6.1 Create `src/bun/jobs/retention-job.ts` — exports `startRetentionJob(db, waitFn?)` that calls `runNow()` immediately on startup then loops with `waitFn(5 * 60_000)` every 5 minutes; `runNow()` deletes `model_raw_messages` older than 1 day (`DELETE FROM model_raw_messages WHERE created_at < datetime('now', '-1 day')`) and `stream_events` older than 4 hours (`DELETE FROM stream_events WHERE created_at < datetime('now', '-4 hours')`); exposes `runNow()` for direct test invocation; `WaitFn` injected same pattern as `WriteBuffer`
- [ ] 6.2 Wire `startRetentionJob(db)` in `src/bun/index.ts` after migrations complete

## 7. StreamProcessor refactor

- [ ] 7.1 Update `StreamProcessor` constructor to accept `Database`, `ConvMessageBuffer`, `RawMessageBuffer`, and `WriteBuffer<PersistedStreamEvent>` (with `StreamEventEnricher`)
- [ ] 7.2 Replace all `getDb()` calls inside `StreamProcessor` with the injected `db`
- [ ] 7.3 Add flush calls at `tool_call` and `tool_result` boundaries in `consume()` for all three write buffers
- [ ] 7.4 Wrap the `consume()` loop body in `try/finally` — call `buffer.stop()` on all three buffers in `finally`

## 8. Full DI threading — executors

- [ ] 8.1 Update `TransitionExecutor` constructor to accept `Database`; remove `getDb()` calls
- [ ] 8.2 Update `HumanTurnExecutor` constructor to accept `Database`; remove `getDb()` calls
- [ ] 8.3 Update `RetryExecutor` constructor to accept `Database`; remove `getDb()` calls
- [ ] 8.4 Update `ChatExecutor` constructor to accept `Database`; remove `getDb()` calls
- [ ] 8.5 Update `CodeReviewExecutor` constructor to accept `Database`; remove `getDb()` calls
- [ ] 8.6 Update `Orchestrator` constructor to accept `Database`; thread it to all executors

## 9. Full DI threading — handlers

- [ ] 9.1 Update `taskHandlers(db, ...)` to accept `Database` as first argument; remove `getDb()` calls inside
- [ ] 9.2 Update `boardHandlers(db)` to accept `Database`; remove `getDb()` calls
- [ ] 9.3 Update `conversationHandlers(db, ...)` to accept `Database`; remove `getDb()` calls
- [ ] 9.4 Update `chatSessionHandlers(db, ...)` to accept `Database`; remove `getDb()` calls
- [ ] 9.5 Update remaining handler factories (`workspaceHandlers`, `projectHandlers`, etc.) that call `getDb()` internally
- [ ] 9.6 Update `src/bun/index.ts`: call `getDb()` exactly once, thread `db` to all constructors and factory functions

## 10. PositionService

- [ ] 10.1 Create `src/bun/handlers/position-service.ts` — extract `rebalanceColumnPositions` and `reorderColumn` from `tasks.ts`; wrap all UPDATE loops in `db.transaction()`; accept `Database` via constructor
- [ ] 10.2 Update `tasks.ts` to use `PositionService` instead of the inline position logic

## 11. SQL query fixes

- [ ] 11.1 Fix `tasks.list` in `tasks.ts`: replace correlated `(SELECT COUNT(*) FROM executions WHERE task_id = t.id)` subquery with `LEFT JOIN executions ... GROUP BY tasks.id`
- [ ] 11.2 Wrap the `tasks.delete` DELETE sequence in a single `db.transaction()`

## 12. ContextEstimator

- [ ] 12.1 Create `src/bun/conversation/context-estimator.ts` — `ContextEstimator` class with `Database` injected via constructor; implements fast path (last completed execution `input_tokens`) and compaction-anchored slow path (`LIMIT 200` on live window)
- [ ] 12.2 Delete `estimateContextUsage` from `src/bun/conversation/context.ts` and `estimateConversationContextUsage` from `src/bun/context-usage.ts`; update all callers to use `ContextEstimator`

## 13. Verification

- [ ] 13.1 Run `bun test src/bun/test --timeout 20000` — all pre-existing passing tests must still pass
- [ ] 13.2 Run `bun test e2e/api --timeout 30000` — smoke tests must pass
- [ ] 13.3 Manual smoke: start the app, open a board with tasks, start an AI session, verify board renders without lag and chat loads immediately
