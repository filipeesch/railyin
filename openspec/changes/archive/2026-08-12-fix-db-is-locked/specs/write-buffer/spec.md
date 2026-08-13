## ADDED Requirements

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
