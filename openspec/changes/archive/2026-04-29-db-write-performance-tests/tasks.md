## 1. Shared Test Infrastructure

- [x] 1.1 Create `src/bun/test/support/mock-wait.ts` — export `createMockWait()` returning `{ waitFn: WaitFn, tick: () => void }` where `waitFn(ms)` returns a promise that only resolves when `tick()` is called; each call to `waitFn` creates a fresh pending promise; covers MW-1 and MW-2

## 2. WriteBuffer Unit Tests

- [x] 2.1 Create `src/bun/test/write-buffer.test.ts` — use a simple array-sink `flushFn`; cover WB-1 (count auto-flush), WB-2 (tick-based interval flush, tick-with-empty-buffer is no-op), WB-3 (manual flush returns items, empty returns `[]`), WB-4 (stop flushes remaining items); inject `createMockWait()` for all timer cases

## 3. StreamEventEnricher Unit Tests

- [x] 3.1 Create `src/bun/test/stream-event-enricher.test.ts` — pure unit tests; cover SEE-1 (block ID increments on type boundary, consecutive same-type shares ID), SEE-2 (seq is 0-indexed monotone), SEE-3 (new instance resets both counters)

## 4. ConvMessageBuffer Integration Tests

- [x] 4.1 Create `src/bun/test/conv-message-buffer.test.ts` — use `initDb()` from `helpers.ts`; cover CMB-1 (enqueue does not write to DB), CMB-2 (flush inserts all rows in one transaction, returns `ConversationMessage[]` with real IDs, content matches enqueued data), CMB-3 (empty flush returns `[]`, no DB write)

## 5. RawMessageBuffer Integration Tests

- [x] 5.1 Create `src/bun/test/raw-message-buffer.test.ts` — use `initDb()`; wire `RawMessageBuffer` as `WriteBuffer<RawModelMessage>` with `maxBatch: 50`; cover: 49 messages do not flush, 50th triggers auto-flush, manual `flush()` returns all pending rows, data integrity (fields preserved after round-trip)

## 6. RetentionJob Integration Tests

- [x] 6.1 Create `src/bun/test/retention-job.test.ts` — use `initDb()` + `createMockWait()`; cover RJ-1 (raw messages older than 1d deleted, <1d survives), RJ-2 (stream events older than 4h deleted, <4h survives), RJ-3 (immediate run on `start()`, each `tick()` triggers another `runNow()`), RJ-4 (`stop()` halts loop); seed old rows using `datetime('now', '-25 hours')` and `datetime('now', '-5 hours')` literals in INSERT

## 7. ContextEstimator Integration Tests

- [x] 7.1 Create `src/bun/test/context-estimator.test.ts` — use `initDb()`; cover CE-1 (fast path: completed execution `input_tokens` returned), CE-2 (slow path: compaction anchor, 10 post-anchor messages counted; LIMIT cap with 210 messages drops 10; type-weighted heuristic verified numerically), CE-3 (`maxTokens` cap applied), CE-4 (empty conversation returns overhead constant)

## 8. PositionService Integration Tests

- [x] 8.1 Create `src/bun/test/position-service.test.ts` — use `initDb()` + `seedProjectAndTask()`; cover PS-1 (rebalance renumbers tasks with even spacing atomically), PS-2 (reorder moves task to new position, relative order preserved), PS-3 (transaction atomicity: partial failure rolls back)

## 9. StreamProcessor Tests — SP-1..SP-6 Rewire

- [x] 9.1 Update `src/bun/test/stream-processor.test.ts` — remove `StreamBatcher` references; inject `ConvMessageBuffer`, `RawMessageBuffer`, `WriteBuffer<PersistedStreamEvent>`, and `StreamEventEnricher` with real in-memory DB buffers; add `onNewMessage` spy; update SP-1..SP-6 to assert real IDs, flush behaviour at boundaries, and correct `onNewMessage` call count; cover specs SP-1 through SP-6

## 10. backend-rpc-runtime Migration

- [x] 10.1 Update `src/bun/test/support/backend-rpc-runtime.ts` — remove lines 11 and 74–144 (`StreamBatcher` map + per-execution batcher management); construct `ConvMessageBuffer`, `RawMessageBuffer`, `WriteBuffer<PersistedStreamEvent>` with in-memory DB; inject into `StreamProcessor`; keep `getDbStreamEvents()` (lines 165–187) unchanged; verify all 11 scenarios in `stream-pipeline-scenarios.test.ts` still pass after migration

## 11. Handlers Tests — tasks.list and tasks.delete

- [x] 11.1 Update `src/bun/test/handlers.test.ts` — add test group for `tasks.list` JOIN fix: seed task with N executions, verify `executionCount` is N; seed task with 0 executions, verify 0; cover ESP-1
- [x] 11.2 Update `src/bun/test/handlers.test.ts` — add test group for `tasks.delete` atomicity: seed task with rows in all 6 related tables, call delete, verify all related rows removed; cover ESP-2

## 12. Full Suite Validation

- [x] 12.1 Run `bun test src/bun/test --timeout 20000` — all tests must pass; no regressions in 11 existing `stream-pipeline-scenarios.test.ts` scenarios; no `sleep()` in any new test file
