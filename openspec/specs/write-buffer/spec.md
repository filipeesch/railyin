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
The system SHALL provide a `ConvMessageBuffer` that uses `WriteBuffer<PendingConvMsg>` to batch message appends, flushing via an injected `ConversationMessageStore.appendBatch()` call (file-backed store for new conversations, legacy SQL `db.transaction()` with `RETURNING id` for pre-existing conversations) rather than issuing SQL directly itself.

#### Scenario: Real IDs returned after flush
- **WHEN** `ConvMessageBuffer.flush()` is called with pending messages
- **THEN** all messages are appended via the resolved `ConversationMessageStore` in a single batch operation, real ids are returned, and `onNewMessage` is called once per inserted message with its real id

#### Scenario: ConvMessageBuffer does not branch on storage medium
- **WHEN** `ConvMessageBuffer` flushes messages for any conversation
- **THEN** it calls the injected `ConversationMessageStore`'s `appendBatch()` method and does not itself check whether the conversation is file-backed or legacy SQLite-backed

### Requirement: WriteBuffer used for model_raw_messages writes
The system SHALL provide a `RawMessageBuffer` that uses `WriteBuffer<RawModelMessage>` to batch raw message writes, flushing via an injected append function that writes to the per-execution debug log file instead of the `model_raw_messages` table.

#### Scenario: Batch flush at count threshold
- **WHEN** 50 raw messages have been enqueued
- **THEN** all 50 are appended to the execution's debug log file in a single flush operation

#### Scenario: Flush on execution end
- **WHEN** the execution completes (done/error/cancel) and messages remain in the buffer
- **THEN** all remaining messages are flushed to the debug log file in a single operation
