## Why

`db-write-performance` introduces five new classes (`WriteBuffer`, `StreamEventEnricher`, `ConvMessageBuffer`, `RetentionJob`, `ContextEstimator`), extracts `PositionService`, deletes `StreamBatcher`, and rewires `StreamProcessor` with full DI. These are the hottest paths in the system — every streaming token, every board move, every session load flows through them. Without a structured test suite the architectural migration carries high regression risk. This change delivers that safety net: unit tests for pure logic, integration tests with in-memory SQLite for buffer/job behaviour, and updated backend integration scenarios that reflect the post-`StreamBatcher` world.

## What Changes

- Add `src/bun/test/support/mock-wait.ts` — shared `createMockWait()` helper that provides an injectable `WaitFn` + `tick()` handle for deterministic timer control in all timer-based tests
- Add `src/bun/test/write-buffer.test.ts` — pure unit tests for `WriteBuffer<T>`: enqueue, count-based flush, interval flush (via `tick()`), `stop()` + final flush, `flush()` return value
- Add `src/bun/test/stream-event-enricher.test.ts` — pure unit tests for `StreamEventEnricher`: block ID assignment by type, monotonic seq, multi-type sequences
- Add `src/bun/test/conv-message-buffer.test.ts` — integration tests with in-memory DB for `ConvMessageBuffer`: `enqueue` + `flush()` returns real IDs, single transaction, empty flush is a no-op
- Add `src/bun/test/raw-message-buffer.test.ts` — integration tests with in-memory DB for `RawMessageBuffer` (`WriteBuffer<RawModelMessage>`): count-based flush (50), manual flush, data integrity
- Add `src/bun/test/retention-job.test.ts` — integration tests with in-memory DB: `runNow()` correctness, age thresholds (1d for raw messages, 4h for stream events), timer loop via `createMockWait()` + `tick()`
- Add `src/bun/test/context-estimator.test.ts` — integration tests with in-memory DB: fast path (last completed execution `input_tokens`), slow path (compaction anchor, LIMIT 200, type-weighted heuristic), cap behaviour
- Add `src/bun/test/position-service.test.ts` — integration tests with in-memory DB for `PositionService`: rebalance, reorder, atomicity (transaction wraps both UPDATEs)
- Update `src/bun/test/stream-processor.test.ts` — rewire SP-1..SP-6 to inject real in-memory DB buffers (`ConvMessageBuffer`, `RawMessageBuffer`, `WriteBuffer<PersistedStreamEvent>`) instead of mocked singletons; verify `onNewMessage` fires with real IDs per message
- Update `src/bun/test/support/backend-rpc-runtime.ts` — remove `StreamBatcher` map; construct DI buffers; keep `getDbStreamEvents()` unchanged
- Update `src/bun/test/handlers.test.ts` — add coverage for `tasks.list` JOIN (execution counts correct), `tasks.delete` transaction (all 6 tables cleaned atomically)

## Capabilities

### New Capabilities
- `write-buffer-tests`: Unit and integration test coverage for `WriteBuffer<T>` and its timer injection pattern
- `stream-event-enricher-tests`: Unit tests for `StreamEventEnricher` block ID and seq logic
- `conv-message-buffer-tests`: Integration tests for `ConvMessageBuffer` boundary-triggered flush and `onNewMessage` delivery
- `retention-job-tests`: Integration tests for `RetentionJob` thresholds and timer loop
- `context-estimator-tests`: Integration tests for `ContextEstimator` fast/slow paths and LIMIT cap
- `position-service-tests`: Integration tests for `PositionService` transactional position management
- `mock-wait-helper`: Shared `createMockWait()` / `tick()` helper for all timer-based test suites
- `stream-processor-tests-updated`: Updated SP-1..SP-6 scenarios wired with real in-memory DB buffers
- `backend-rpc-runtime-updated`: Migrated test runtime — `StreamBatcher` removed, DI buffers constructed

### Modified Capabilities
- `engine-stream-processor`: SP-1..SP-6 test scenarios updated to reflect injected-buffer architecture; `onNewMessage` assertions now verify real DB IDs

## Impact

- New files: `src/bun/test/support/mock-wait.ts`, `write-buffer.test.ts`, `stream-event-enricher.test.ts`, `conv-message-buffer.test.ts`, `raw-message-buffer.test.ts`, `retention-job.test.ts`, `context-estimator.test.ts`, `position-service.test.ts`
- Modified: `src/bun/test/stream-processor.test.ts`, `src/bun/test/support/backend-rpc-runtime.ts`, `src/bun/test/handlers.test.ts`
- No production code changes; no API or frontend changes
- Test runner: `bun test src/bun/test --timeout 20000` (existing command)
