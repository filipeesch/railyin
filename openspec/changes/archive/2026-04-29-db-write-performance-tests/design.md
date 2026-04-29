## Context

`db-write-performance` replaces `StreamBatcher` with `WriteBuffer` + `StreamEventEnricher`, introduces `ConvMessageBuffer` (boundary-triggered), `RetentionJob`, `ContextEstimator`, and `PositionService`, and wires full DI through `StreamProcessor` and all handlers. These classes have no existing test coverage. The existing `stream-pipeline-scenarios.test.ts` (11 scenarios) and `stream-processor.test.ts` (SP-1..SP-6) tested the old `StreamBatcher`-based architecture and must be migrated to the new injected-buffer model.

The primary constraint is determinism: `WriteBuffer` and `RetentionJob` both use timers. Tests that rely on `setInterval` or `sleep()` are inherently flaky. The `WaitFn` injection pattern eliminates this risk by giving tests direct control over when a tick resolves.

## Goals / Non-Goals

**Goals:**
- 100% coverage of new classes' public API surface
- Deterministic timer testing with zero `sleep()` / flakiness risk
- Real in-memory SQLite for all DB-touching tests (no mocks of DB layer)
- 11 existing `stream-pipeline-scenarios` remain passing unchanged
- SP-1..SP-6 rewired to injected buffers and asserting real IDs
- `handlers.test.ts` extended for JOIN fix and `tasks.delete` transaction

**Non-Goals:**
- Playwright / UI tests (pure backend refactor, no new UI surface)
- Coverage of production code paths not introduced or modified by `db-write-performance`
- Mutation testing (covered by separate nightly CI)

## Decisions

### D1: `createMockWait()` — shared timer injection helper

**File**: `src/bun/test/support/mock-wait.ts`

```
createMockWait() → { waitFn: WaitFn, tick: () => void }
```

- `waitFn(ms)` returns a `Promise` that resolves only when `tick()` is called
- `tick()` resolves the currently-pending promise and resets the internal resolver
- `stop()` on `WriteBuffer` / `RetentionJob` calls `tick()` internally (Option A / stop+tick)
- This gives tests full control: enqueue items → `tick()` → assert flush happened
- Shared in `test/support/` alongside `helpers.ts` and `backend-rpc-runtime.ts`

### D2: Real in-memory DB for all integration tests

All tests that exercise `ConvMessageBuffer`, `RawMessageBuffer`, `RetentionJob`, `ContextEstimator`, `PositionService` use `initDb()` from `helpers.ts` (already uses `RAILYN_DB=:memory:`). No SQLite mocks. This ensures SQL correctness (schema, indices, `RETURNING`, transaction semantics) is validated against real SQLite.

### D3: `WriteBuffer` unit tests — pure, no DB

`WriteBuffer<T>` is generic and has no DB dependency. Unit tests use a simple in-memory `flushFn` array sink. This keeps `write-buffer.test.ts` fast and focused on buffer mechanics.

### D4: `ConvMessageBuffer` — `flush()` return value is the assertion target

`flush()` returns `ConversationMessage[]` (rows from `RETURNING id`). Tests verify:
1. The returned array has correct length
2. Each item has a real integer `id` (> 0)
3. The data matches what was enqueued
4. A second `flush()` on an empty buffer returns `[]` (no-op)
5. `StreamProcessor` (SP tests) calls `onNewMessage` for each returned row

### D5: `RetentionJob` — age threshold tests use relative timestamps

Tests insert rows with `created_at = datetime('now', '-25 hours')` for raw messages and `datetime('now', '-5 hours')` for stream events, then call `runNow()` and assert the old rows are deleted but fresh rows survive.

### D6: `ContextEstimator` — seeded DB, assert token counts

Fast path: seed `executions` row with known `input_tokens`, call `estimate(conversationId, maxTokens)` → assert result matches execution `input_tokens`.

Slow path: seed `conversation_messages` with a `compaction_summary` anchor at position N and 210 messages after it. Assert that:
1. Only messages after the anchor are counted (not the summary itself)
2. The cap limits to 200 messages (10 messages dropped)
3. Type-weighted heuristic applies (tool messages vs others)

### D7: `backend-rpc-runtime.ts` migration — remove `StreamBatcher` map

Lines 11 and 74–144 currently manage a `Map<string, StreamBatcher>` keyed on execution ID. This block is fully deleted. Instead the runtime constructs `ConvMessageBuffer`, `RawMessageBuffer`, and `WriteBuffer<PersistedStreamEvent>` with in-memory DB and injects them into `StreamProcessor`. `getDbStreamEvents()` (lines 165–187) queries DB directly and is unchanged.

### D8: 11 existing stream-pipeline scenarios — unchanged

The 11 scenarios in `stream-pipeline-scenarios.test.ts` test the two-channel (IPC vs DB) split at the `StreamProcessor.process()` API boundary. That API boundary is preserved. After the `StreamBatcher` removal the scenarios still pass because `getDbStreamEvents()` reads the real DB (via the injected `WriteBuffer` flushing on each `backend-rpc-runtime` call to `flush()`). No scenario rewrites needed.

### D9: SP-1..SP-6 in `stream-processor.test.ts` — real buffers, not stubs

Each scenario wires:
- `ConvMessageBuffer` with in-memory DB
- `RawMessageBuffer` with in-memory DB
- `WriteBuffer<PersistedStreamEvent>` with in-memory DB
- `StreamEventEnricher` (per-execution instance)

`onNewMessage` is a Jest/Bun spy. Tests assert it was called once per boundary-triggered message with a non-null `id`.

## Risks / Trade-offs

**[Risk] `tick()` race with async loop** → `WriteBuffer` loop is `while (running) { await waitFn(ms); flush() }`. Since `tick()` resolves the current awaited promise synchronously before the loop body runs again, the call sequence is deterministic. No race.

**[Trade-off] Real in-memory DB for integration tests is slower than mocks** → Acceptable. `initDb()` is fast (~1ms). Tests are grouped by file and run in parallel by Bun's test runner. Total suite time stays well within the 20-second timeout.

**[Risk] `RETURNING id` requires SQLite ≥ 3.35** → Bun bundles SQLite 3.43+. Not a risk.
