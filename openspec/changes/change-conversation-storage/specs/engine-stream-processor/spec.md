## MODIFIED Requirements

### Requirement: StreamProcessor flushes all write buffers at tool boundaries
The `StreamProcessor.consume()` loop SHALL call `flush()` on `ConvMessageBuffer` and `RawMessageBuffer` at tool boundaries and on execution end. There is no longer a `WriteBuffer<PersistedStreamEvent>` to flush.

#### Scenario: Flush at tool_call boundary
- **WHEN** a `tool_call` event is received from the engine
- **THEN** both write buffers are flushed before the event processing continues

#### Scenario: Flush at tool_result boundary
- **WHEN** a `tool_result` event is received from the engine
- **THEN** both write buffers are flushed after the result is enqueued

#### Scenario: Flush on execution done/error/cancel
- **WHEN** the engine emits `done`, or an error or cancellation occurs
- **THEN** both write buffers are stopped (timer cleared + final flush) inside the `finally` block of `consume()`

### Requirement: tasks.delete wrapped in db.transaction()
The `tasks.delete` operation SHALL wrap all its DELETE statements in a single `db.transaction()`, and SHALL additionally delete the task's conversation file, sidecar, and any per-execution debug log files from disk if the conversation is file-backed. The file deletion SHALL happen outside the SQL transaction (after it commits), since filesystem operations are not part of the SQLite transaction.

#### Scenario: Task deletion is atomic in SQL
- **WHEN** `tasks.delete(taskId)` is called
- **THEN** all related SQL rows (task, executions, conversation_messages for legacy conversations, decision_records, etc.) are deleted in a single WAL transaction

#### Scenario: File-backed conversation's files are removed after the SQL transaction commits
- **WHEN** `tasks.delete(taskId)` is called for a task whose conversation is file-backed
- **THEN** after the SQL transaction commits, the conversation's `.jsonl`, `.meta.json`, and debug log files are deleted from disk

### Requirement: ESP-2 `tasks.delete` removes all related data atomically
After the transaction wrap, `tasks.delete` SHALL remove all related SQL rows in one atomic operation, and SHALL also remove the task's conversation file(s) from disk when file-backed.

#### Scenario: All related SQL rows removed
- **GIVEN** a task with executions and messages in the legacy `conversation_messages` table
- **WHEN** `tasks.delete` is called
- **THEN** all related rows across all related SQL tables are removed

#### Scenario: Partial failure rolls back entire SQL delete
- **GIVEN** a delete operation that would violate a constraint mid-way
- **WHEN** the transaction encounters the violation
- **THEN** no SQL rows are removed, and no file deletion is attempted

#### Scenario: File-backed task's conversation files are also removed
- **GIVEN** a task whose conversation is file-backed, with a JSONL file, sidecar, and debug log files on disk
- **WHEN** `tasks.delete` is called and the SQL transaction commits successfully
- **THEN** the conversation's JSONL file, sidecar, and debug log files are deleted from disk

