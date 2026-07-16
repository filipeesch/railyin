## ADDED Requirements

### Requirement: Raw model messages are persisted to a per-execution debug log file
The system SHALL persist raw model request/response payloads (previously stored in the `model_raw_messages` SQLite table) to an append-only debug log file per execution, at `~/.railyn/conversations/<conversationId>.debug.<executionId>.jsonl` (or under `$RAILYN_DATA_DIR` when overridden). This log SHALL exist purely for debugging and replay inspection and SHALL NOT be read by any production request path.

#### Scenario: Raw message appended during execution
- **WHEN** the engine sends or receives a raw model message during an execution
- **THEN** a line containing that raw payload is appended to the execution's debug log file

#### Scenario: Debug log is not required for normal chat rendering
- **WHEN** a user loads or streams a conversation in the UI
- **THEN** the debug log file is never read; only the `ConversationMessageStore` is consulted

### Requirement: Debug log writes are buffered and flushed at existing boundaries
Debug log writes SHALL be buffered in-process and flushed at the same points the current `RawMessageBuffer` flushes (tool-call boundaries and execution end), preserving existing ordering guarantees via the existing `rawMessageSeq` mechanism.

#### Scenario: Flush at tool boundary
- **WHEN** a `tool_call` or `tool_result` event is processed during stream consumption
- **THEN** any buffered raw messages for the current execution are flushed to its debug log file before processing continues

#### Scenario: Flush on execution end
- **WHEN** an execution reaches `done`, `error`, or `cancelled`
- **THEN** any remaining buffered raw messages are flushed to the debug log file before the buffer is torn down

### Requirement: Debug log files are deleted alongside their conversation
Debug log files SHALL be deleted whenever the conversation file cleanup for a deleted task or archived-and-swept chat session runs, so no orphaned debug logs remain after the conversation itself is removed.

#### Scenario: Task deletion removes its executions' debug logs
- **WHEN** a task with one or more executions is deleted
- **THEN** every debug log file matching that task's conversation is deleted from disk

#### Scenario: Retention sweep removes debug logs for hard-deleted sessions
- **WHEN** `RetentionJob` hard-deletes an archived chat session
- **THEN** every debug log file matching that session's conversation is deleted from disk

### Requirement: model_raw_messages table and its access paths are removed
The `model_raw_messages` SQLite table, its migration-created indices, and the `RawMessageBuffer`'s SQL insert path SHALL be removed in favor of the file-based debug log. No production code SHALL query `model_raw_messages`.

#### Scenario: No remaining references to model_raw_messages table
- **WHEN** the codebase is searched after this change ships
- **THEN** no application code queries or inserts into a `model_raw_messages` table
