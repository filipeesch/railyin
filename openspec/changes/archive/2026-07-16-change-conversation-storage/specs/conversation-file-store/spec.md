## ADDED Requirements

### Requirement: Conversation messages are stored as per-conversation append-only files
The system SHALL store the durable message history for conversations created after this change ships as an append-only JSON Lines file at `~/.railyn/conversations/<conversationId>.jsonl` (or `$RAILYN_DATA_DIR/conversations/<conversationId>.jsonl` when the data dir override is set), one JSON object per line. Conversations that already existed before this change ships SHALL continue to be served from the existing `conversation_messages` SQLite table and SHALL NOT be migrated into a file.

#### Scenario: New conversation writes to a JSONL file
- **WHEN** a message is appended to a conversation created after this change ships
- **THEN** a line containing the message's JSON representation is appended to `~/.railyn/conversations/<conversationId>.jsonl`

#### Scenario: Pre-existing conversation continues reading from SQLite
- **WHEN** a message is read from or appended to a conversation that existed before this change shipped
- **THEN** the read or write is served by the existing `conversation_messages` SQLite table, not a file

### Requirement: Message id is derived from file line position
For file-backed conversations, a message's `id` SHALL be its 1-based line number within the conversation's JSONL file. The `id` SHALL NOT be duplicated as a separate persisted counter; it SHALL be a pure function of append order and file position.

#### Scenario: First message gets id 1
- **WHEN** the first message is appended to a new conversation's file
- **THEN** that message's `id` is `1`

#### Scenario: ids are dense and monotonic per conversation
- **WHEN** N messages have been appended to a conversation's file
- **THEN** their ids are exactly `1..N` in append order, with no gaps

#### Scenario: Corrupted or partially-written line is tombstoned, not renumbered
- **WHEN** a line in the JSONL file is detected as corrupted or partially written (e.g. after an unclean process exit)
- **THEN** the system replaces that line with a tombstone placeholder rather than removing it, so all subsequent line numbers (ids) remain stable

### Requirement: Sidecar metadata file accelerates hot queries
Each conversation file SHALL have a companion sidecar file `<conversationId>.meta.json` containing at minimum `lineCount`, `lastCompactionSummaryId`, `lastCompactionSummaryByteOffset`, and `byteLength`. The sidecar SHALL be updated atomically (write to a temp file, then rename) on every append. Hot queries (compaction-anchor lookup, point lookup by id, and unanchored reverse pagination) SHALL use the sidecar to avoid a full-file scan.

#### Scenario: Sidecar updated after append
- **WHEN** a message is appended to a conversation's JSONL file
- **THEN** the sidecar's `lineCount` and `byteLength` are updated to reflect the new file state, written via temp-file-then-rename

#### Scenario: Compaction anchor lookup uses sidecar directly
- **WHEN** the system needs the id of the most recent `compaction_summary` message for a file-backed conversation
- **THEN** it reads `lastCompactionSummaryId` from the sidecar instead of scanning the JSONL file

#### Scenario: Sidecar drift is self-healed
- **WHEN** the sidecar's recorded `byteLength` does not match the actual file size on disk
- **THEN** the system recomputes the sidecar from the JSONL file before serving the query

### Requirement: Concurrent appends to the same conversation are serialized in-process
Writes to a given conversation's file SHALL be serialized through an in-process async write queue keyed by `conversationId`, ensuring appends never interleave or corrupt the file. No OS-level file locking (e.g. `flock`) SHALL be used.

#### Scenario: Two concurrent appends to the same conversation do not interleave
- **WHEN** two messages are appended to the same conversation at nearly the same time (e.g. a background compaction summary and a live user message)
- **THEN** both are written as complete, non-interleaved lines, in the order their append calls were issued

#### Scenario: Appends to different conversations proceed independently
- **WHEN** messages are appended concurrently to two different conversations
- **THEN** neither append waits on the other's write queue

### Requirement: ConversationMessageStore is the sole abstraction for message access
The system SHALL expose a `ConversationMessageStore` interface covering append, point lookup by id, last-message-of-type lookup, range-from-id, cursor-based paging, filtered/full scan, and deletion. All application code that previously issued SQL directly against `conversation_messages` SHALL depend on this interface via constructor injection instead of a raw `Database` handle for message access. Exactly one resolver SHALL decide, per `conversationId`, whether to use the file-backed or legacy SQLite implementation; no other code SHALL branch on storage medium.

#### Scenario: Callers use the interface, not raw SQL
- **WHEN** any of `context.ts`, `context-estimator.ts`, `cross-engine-context.ts`, `decision-context-injector.ts`, `handlers/conversations.ts`, `handlers/chat-sessions.ts`, `board-tool-executor.ts`, `chat-executor.ts`, `human-turn-executor.ts`, `code-review-executor.ts`, or `session-memory.ts` needs to read or write conversation messages
- **THEN** it calls a method on an injected `ConversationMessageStore` instance rather than issuing SQL against `conversation_messages` directly

#### Scenario: Resolver is the only storage-medium branch point
- **WHEN** a `ConversationMessageStore` is obtained for a given `conversationId`
- **THEN** exactly one resolver function decides whether the file-backed or legacy SQLite implementation is returned, and no calling code performs its own storage-medium check

### Requirement: Conversation file is deleted when its owning task or chat session is deleted
The system SHALL delete a conversation's JSONL file and sidecar when the task or chat session it belongs to is deleted, alongside the existing SQL row deletes.

#### Scenario: Task deletion removes its conversation file
- **WHEN** `tasks.delete` (or the AI-invoked task-deletion tool) removes a task that has a file-backed conversation
- **THEN** the conversation's `.jsonl` and `.meta.json` files are deleted from disk

#### Scenario: Archived chat session hard-delete removes its conversation file
- **WHEN** `RetentionJob` hard-deletes a chat session that was archived more than 7 days ago and has a file-backed conversation
- **THEN** the conversation's `.jsonl` and `.meta.json` files are deleted from disk

#### Scenario: Deleting a legacy (SQLite-backed) conversation does not attempt file deletion
- **WHEN** a task or chat session with a pre-existing, SQLite-backed conversation is deleted
- **THEN** no file deletion is attempted for that conversation, only the existing SQL deletes run
