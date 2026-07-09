## MODIFIED Requirements

### Requirement: Conversation is an append-only message timeline
Each task's conversation SHALL be an ordered, append-only sequence of messages. Messages are never deleted or reordered. The conversation serves as the canonical history of everything that happened to the task. The canonical chronology SHALL follow append order, and conversation reads SHALL preserve that order even when multiple messages share the same timestamp. The append-only guarantee SHALL hold regardless of whether the underlying storage medium for a given conversation is a per-conversation JSONL file or the legacy `conversation_messages` SQLite table.

#### Scenario: Messages accumulate across executions
- **WHEN** multiple executions run for the same task
- **THEN** all messages from all executions appear in a single chronological timeline

#### Scenario: Messages cannot be deleted
- **WHEN** a task exists
- **THEN** the system provides no mechanism to delete individual conversation messages

#### Scenario: Messages created in the same second keep append order
- **WHEN** `reasoning`, `tool_call`, `tool_result`, `file_diff`, and `assistant` messages are appended within the same timestamp second
- **THEN** conversation reads return them in the same order they were appended

#### Scenario: Timeline assembly does not reorder neighboring message types
- **WHEN** the frontend groups tool rows or renders live chat items
- **THEN** the visible conversation preserves the same relative order as the underlying append-only message sequence

#### Scenario: Append-only ordering holds for file-backed conversations
- **WHEN** a conversation created after this change ships is stored as a JSONL file
- **THEN** its messages are still read back in strict append order, with ids equal to line number

### Requirement: Conversation read APIs use conversationId as the canonical identifier
The system SHALL treat `conversationId` as the primary identifier for conversation message reads across both task and standalone session conversations, regardless of whether the conversation's messages live in a file or in the legacy `conversation_messages` table.

#### Scenario: Messages read by conversationId
- **WHEN** a caller requests conversation messages with a `conversationId`
- **THEN** the system returns the ordered messages for that conversation regardless of whether it belongs to a task or a standalone session, and regardless of storage medium

### Requirement: Conversation read APIs require conversationId
The system SHALL require `conversationId` for conversation-scoped read APIs. Message reads and context-usage reads SHALL use `conversationId` directly and SHALL NOT depend on task-based aliases.

#### Scenario: Messages read with conversationId
- **WHEN** a caller requests conversation messages
- **THEN** the request includes `conversationId`
- **AND** the system returns messages for that conversation in append order

#### Scenario: Context usage read with conversationId
- **WHEN** a caller requests context usage for a conversation
- **THEN** the request includes `conversationId`
- **AND** the system computes usage for that conversation without requiring a task identifier

## REMOVED Requirements

### Requirement: stream_events schema uses conversation_id as primary routing key
**Reason**: `stream_events` is dropped entirely. Live stream events are broadcast over WebSocket in-memory and never persisted; the only durable, replayable record of an execution's raw model traffic is now the file-based debug log (see `raw-message-debug-log`). The `conversations.getStreamEvents` RPC had zero live frontend callers, confirming this table's persistence path was dead weight.

**Migration**: The `stream_events` table, its indices, and the migration that introduced `conversation_id` routing are dropped via a cleanup migration. No data is carried forward.

### Requirement: All new stream-event writes populate conversation_id
**Reason**: Superseded by the removal of `stream_events` persistence entirely; there are no new stream-event writes to populate.

**Migration**: None — the write path (`WriteBuffer<PersistedStreamEvent>`) is deleted along with the table.

### Requirement: Historical stream events are repaired by execution first, task second
**Reason**: The repair job operated on `stream_events` rows, which no longer exist after this table is dropped.

**Migration**: The repair job and its migration are removed; any remaining legacy `stream_events` rows are dropped by the cleanup migration rather than repaired.
