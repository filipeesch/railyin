## ADDED Requirements

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

### Requirement: WriteBuffer used for model_raw_messages writes
The system SHALL provide a `RawMessageBuffer` that uses `WriteBuffer<RawModelMessage>` to batch `model_raw_messages` INSERTs using `db.transaction()`.

#### Scenario: Batch insert at count threshold
- **WHEN** 50 raw messages have been enqueued
- **THEN** all 50 are inserted in a single `db.transaction()`

#### Scenario: Flush on execution end
- **WHEN** the execution completes (done/error/cancel) and messages remain in the buffer
- **THEN** all remaining messages are flushed in a single `db.transaction()`

### Requirement: WriteBuffer used for stream_events writes
The system SHALL replace the DB-write side of `StreamBatcher` with `WriteBuffer<PersistedStreamEvent>`, injecting `appendStreamEventBatch` as `flushFn`.

#### Scenario: stream_events flushed at tool boundaries
- **WHEN** a `tool_call` or `tool_result` event is processed
- **THEN** `WriteBuffer.flush()` is called and all buffered stream events are persisted before the tool boundary completes
