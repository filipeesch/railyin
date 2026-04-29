## Why

When multiple AI sessions run concurrently, hundreds of individual autocommit SQLite transactions per response compete for the single WAL writer lock, causing visible slowdowns in board rendering, chat load, and live streaming. The write contention is structural: every token, every raw model message, and every stream event triggers its own flush — and a per-event `DELETE` on `model_raw_messages` fires on every single raw write.

## What Changes

- Introduce a generic `WriteBuffer<T>` primitive that handles buffering, interval flushing, count thresholds, and manual flush at domain boundaries — replacing ad-hoc per-table buffer logic
- Replace `StreamBatcher` with `WriteBuffer<PersistedStreamEvent>` + a stateful `StreamEventEnricher` (block IDs, seq numbers); the WS broadcast path already bypasses `StreamBatcher` and is unaffected
- Add `ConvMessageBuffer` — a boundary-triggered accumulator for `conversation_messages` writes; flushes via `db.transaction()` with `RETURNING id` at tool boundaries (not timer-based); `StreamProcessor` fires `onNewMessage` per returned row preserving existing callback timing
- Add `RawMessageBuffer` — a `WriteBuffer` for `model_raw_messages` writes, flushing every 50 messages or at execution end
- Extract `RetentionJob` — periodic background timer (5 min) for `model_raw_messages` (1 day) and `stream_events` (4 hours) cleanup; remove inline `DELETE` from hot write path; `stream_events` table reduces ~40× from previous 7-day policy
- Extract `PositionService` — wraps `rebalanceColumnPositions` and `reorderColumn` in `db.transaction()` to collapse N individual UPDATE flushes into one
- Consolidate `estimateContextUsage` / `estimateConversationContextUsage` into a single `ContextEstimator` with `estimate(conversationId, maxTokens)`; `conversation_id` is consistent across all tables; fix slow path to anchor on last compaction + live messages with `LIMIT 200`
- Thread `Database` instance via DI from `index.ts` through all executors and handlers — remove `getDb()` service-locator calls throughout
- Fix `tasks.list` correlated subquery (execution count) → `LEFT JOIN + GROUP BY`
- Wrap `tasks.delete` in a single `db.transaction()` (currently 6 separate flushes)
- Add migration `032` with compound indices on `executions` and `tasks`

## Capabilities

### New Capabilities

- `write-buffer`: Generic write-buffer primitive (`WriteBuffer<T>`) with count-based, time-based, and manual flush; used by all streaming write paths
- `stream-event-enricher`: Stateful enricher that assigns `blockId` and `seq` to stream events; pure domain logic extracted from `StreamBatcher`
- `db-retention-job`: Periodic background job that deletes stale `model_raw_messages` and expired `stream_events`
- `position-service`: Transactional task position management (`rebalanceColumnPositions`, `reorderColumn`) extracted from `tasks.ts`
- `context-estimator`: Consolidated, compaction-anchored context usage estimation for both task and chat-session paths

### Modified Capabilities

- `engine-stream-processor`: Streaming pipeline changes — `StreamBatcher` removed, replaced by `WriteBuffer`-based buffers for `stream_events`, `conversation_messages`, and `model_raw_messages`; `StreamProcessor` now receives injected `Database` and buffer instances
- `context-gauge`: Slow-path estimation algorithm changes — now anchors on last `compaction_summary` message rather than loading all messages; `LIMIT 200` cap on live window

## Impact

- `src/bun/engine/stream/stream-processor.ts` — major refactor: DI, buffer injection, retention extraction
- `src/bun/pipeline/batcher.ts` — `StreamBatcher` replaced by `WriteBuffer` + `StreamEventEnricher`
- `src/bun/handlers/tasks.ts` — `PositionService` extraction, correlated subquery fix, `tasks.delete` transaction wrap
- `src/bun/conversation/context.ts` + `src/bun/context-usage.ts` — merged into `ContextEstimator`
- `src/bun/index.ts` — DI wiring, `getDb()` called once and threaded down
- `src/bun/db/index.ts` — `getDb()` kept for migrations/startup only
- All executor classes (`TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, `ChatExecutor`, `CodeReviewExecutor`) — `Database` injected via constructor
- All handler factories — `Database` injected as first argument
- New migration `src/bun/db/migrations/032_perf_indices.ts`
- No API contract changes; no frontend changes required
