## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: WriteBuffer used for stream_events writes
**Reason**: `stream_events` is dropped entirely; there is no persistence path left for `StreamBatcher`'s DB-write side to feed.

**Migration**: `WriteBuffer<PersistedStreamEvent>`, `appendStreamEventBatch`, and the `StreamBatcher` wiring that fed it are removed. The live, unbuffered WebSocket broadcast of stream events is untouched.
