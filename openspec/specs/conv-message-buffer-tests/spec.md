## Purpose
Specifies the test contract for `ConvMessageBuffer`, which batches `conversation_messages` inserts in memory and flushes them in a single transaction.

## Requirements

### Requirement: CMB-1 Enqueue accumulates without DB write
Items passed to `enqueue()` are held in memory and do NOT cause any DB write until `flush()` is called.

#### Scenario: Enqueue does not persist
- **WHEN** N messages are enqueued
- **THEN** the `conversation_messages` table still has 0 rows

### Requirement: CMB-2 Flush writes all pending rows in one transaction and returns real IDs
`flush()` executes all pending INSERTs inside a single `db.transaction()` using `INSERT INTO conversation_messages ... RETURNING id` and returns the inserted `ConversationMessage[]`.

#### Scenario: Flush inserts all rows and returns them with IDs
- **WHEN** `flush()` is called with N enqueued messages
- **THEN** `conversation_messages` has N rows and the returned array has length N with integer `id > 0` per row

#### Scenario: Returned rows match enqueued data
- **WHEN** messages with known content are enqueued and flushed
- **THEN** the returned rows contain the same content in the same order

### Requirement: CMB-3 Flush on empty buffer is a no-op
#### Scenario: Empty flush returns empty array
- **WHEN** `flush()` is called with no pending items
- **THEN** returns `[]` and no DB write occurs

### Requirement: CMB-4 `StreamProcessor` fires `onNewMessage` per returned row
`StreamProcessor` calls `onNewMessage(row)` for each row returned by `ConvMessageBuffer.flush()`.

#### Scenario: onNewMessage called with real IDs
- **WHEN** a boundary (tool_call, done) triggers `flush()`
- **THEN** `onNewMessage` is called once per flushed row with a non-null integer `id`
