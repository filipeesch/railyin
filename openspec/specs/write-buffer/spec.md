## Purpose
TBD — provides a generic, reusable write buffer primitive for batching database writes, used to reduce WAL pressure during streaming.

## Requirements

### Requirement: Generic write buffer primitive
The system SHALL provide a generic `WriteBuffer<T>` class that buffers items in memory and flushes them in batches via an injected `flushFn`.

#### Scenario: Items buffered until flush threshold
- **WHEN** `enqueue(item)` is called and the buffer size reaches `maxBatch`
- **THEN** `flush()` is called automatically and `flushFn` receives all buffered items

#### Scenario: Items flushed by interval timer
- **WHEN** `start()` has been called and `intervalMs` elapses without a manual flush
- **THEN** `flush()` is called and `flushFn` receives all buffered items since last flush

#### Scenario: Manual flush drains buffer
- **WHEN** `flush()` is called with items in the buffer
- **THEN** `flushFn` is called with all buffered items and the buffer is emptied

#### Scenario: Flush on empty buffer is a no-op
- **WHEN** `flush()` is called with an empty buffer
- **THEN** `flushFn` is NOT called

#### Scenario: Stop drains remaining items
- **WHEN** `stop()` is called
- **THEN** the interval timer is cleared and `flush()` is called once for any remaining buffered items

#### Scenario: Constructor with only flushFn (no timer, no count threshold)
- **WHEN** `WriteBuffer` is constructed with only `flushFn` (no `maxBatch`, no `intervalMs`)
- **THEN** the buffer only flushes on explicit `flush()` or `stop()` calls

### Requirement: WriteBuffer used for conversation_messages writes
The system SHALL provide a `ConvMessageBuffer` that uses `WriteBuffer<PendingConvMsg>` to batch `conversation_messages` INSERTs using `db.transaction()` with `RETURNING id`.

#### Scenario: Real IDs returned after flush
- **WHEN** `ConvMessageBuffer.flush()` is called with pending messages
- **THEN** all messages are inserted in a single `db.transaction()`, real row IDs are returned, and `onNewMessage` is called once per inserted message with its real ID

### Requirement: WriteBuffer used for stream_events writes
The system SHALL replace the DB-write side of `StreamBatcher` with `WriteBuffer<PersistedStreamEvent>`, injecting `appendStreamEventBatch` as `flushFn`.

#### Scenario: stream_events flushed at tool boundaries
- **WHEN** a `tool_call` or `tool_result` event is processed
- **THEN** `WriteBuffer.flush()` is called and all buffered stream events are persisted before the tool boundary completes

### Requirement: Flush failures never kill the background loop
`WriteBuffer` SHALL catch errors thrown by `flushFn` during `flush()` so that the background `_loop()` continues running after a failed flush. The loop SHALL log each failure and SHALL NOT terminate on error.

#### Scenario: SQLITE_BUSY during interval flush does not stop the loop
- **WHEN** `flushFn` throws `SQLITE_BUSY` during a timer-driven flush
- **THEN** the error is logged, the loop continues, and subsequent flushes still occur on later ticks

#### Scenario: Persistent flush errors keep the buffer alive
- **WHEN** `flushFn` fails repeatedly
- **THEN** the loop keeps attempting future flushes instead of dying with an unhandled rejection

### Requirement: SQLITE_BUSY batches are requeued with bounded retries
When `flushFn` throws `SQLITE_BUSY`, `WriteBuffer` SHALL requeue the failed items at the front of the pending queue and retry them on the next flush, tracking consecutive failures per batch. After a bounded number of consecutive failures (default 3), the batch SHALL be dropped with an error log to bound memory.

#### Scenario: Busy batch is retried on the next tick
- **WHEN** a flush fails with SQLITE_BUSY and the buffer is flushed again later
- **THEN** the previously failed items are included in the next `flushFn` call

#### Scenario: Batch dropped after retry exhaustion
- **WHEN** the same batch fails with SQLITE_BUSY on 3 consecutive attempts
- **THEN** the batch is dropped, an error is logged, and the buffer continues with new items

### Requirement: Non-busy flush errors drop the batch
When `flushFn` throws an error that is not `SQLITE_BUSY`, `WriteBuffer` SHALL log the error and drop the failed batch (items are not requeued) so a poisoned batch cannot loop forever.

#### Scenario: Constraint error drops the batch
- **WHEN** `flushFn` throws a non-busy SQLite error (e.g. constraint violation)
- **THEN** the batch is dropped with an error log and the buffer continues

### Requirement: stop() never throws
`WriteBuffer.stop()` SHALL catch and log errors from the final `flush()` so shutdown paths cannot crash on a locked database.

#### Scenario: Stop during lock contention is safe
- **WHEN** `stop()` is called while the database is locked
- **THEN** the flush error is logged and `stop()` returns normally
