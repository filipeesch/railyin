## Purpose
Specifies the test contract for `WriteBuffer<T>`, a generic buffer that supports count-based auto-flush, interval-based flush via an injected `WaitFn`, manual flush, and graceful stop.

## Requirements

### Requirement: WB-1 Enqueue and count-based auto-flush
Items enqueued into `WriteBuffer<T>` are held until `maxBatch` is reached, at which point `flushFn` is called automatically with all pending items.

#### Scenario: Count threshold triggers flush
- **WHEN** `maxBatch` items are enqueued
- **THEN** `flushFn` is called once with exactly `maxBatch` items and the buffer is empty

### Requirement: WB-2 Interval-based flush
After each tick of the injected `WaitFn`, any pending items are flushed.

#### Scenario: Tick triggers flush of pending items
- **WHEN** `tick()` is called on the mock wait function
- **THEN** `flushFn` is called with all pending items accumulated since last flush

#### Scenario: Tick with empty buffer is a no-op
- **WHEN** `tick()` is called and no items are pending
- **THEN** `flushFn` is NOT called

### Requirement: WB-3 Manual flush and return value
`flush()` flushes immediately regardless of count or timer and returns the flushed items as `T[]`.

#### Scenario: Manual flush returns flushed items
- **WHEN** `flush()` is called with N pending items
- **THEN** the returned array has length N containing the enqueued items

#### Scenario: Manual flush on empty buffer returns empty array
- **WHEN** `flush()` is called with no pending items
- **THEN** returns `[]` and `flushFn` is not called

### Requirement: WB-4 Stop + final flush
`stop()` halts the timer loop, unblocks the currently-awaited `waitFn` promise, and performs a final synchronous flush of any remaining items.

#### Scenario: Stop flushes remaining items
- **WHEN** `stop()` is called with pending items
- **THEN** `flushFn` is called with the remaining items before the promise settles
