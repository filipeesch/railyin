## MODIFIED Requirements

### Requirement: StreamProcessor receives Database via constructor injection
The `StreamProcessor` class SHALL accept a `Database` instance as a constructor argument. It SHALL NOT call `getDb()` internally.

#### Scenario: Database injected at construction
- **WHEN** `new StreamProcessor(db, convBuffer, rawBuffer, ...)` is called
- **THEN** the instance uses the provided `Database` for all queries and does not import or call `getDb()`

### Requirement: StreamProcessor flushes all write buffers at tool boundaries
The `StreamProcessor.consume()` loop SHALL call `flush()` on `ConvMessageBuffer`, `RawMessageBuffer`, and `WriteBuffer<PersistedStreamEvent>` at tool boundaries and on execution end.

#### Scenario: Flush at tool_call boundary
- **WHEN** a `tool_call` event is received from the engine
- **THEN** all three write buffers are flushed before the event processing continues

#### Scenario: Flush at tool_result boundary
- **WHEN** a `tool_result` event is received from the engine
- **THEN** all three write buffers are flushed after the result is enqueued

#### Scenario: Flush on execution done/error/cancel
- **WHEN** the engine emits `done`, or an error or cancellation occurs
- **THEN** all three write buffers are stopped (timer cleared + final flush) inside the `finally` block of `consume()`

## ADDED Requirements

### Requirement: All executor classes receive Database via constructor injection
All executor classes (`TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, `ChatExecutor`, `CodeReviewExecutor`) SHALL accept a `Database` instance as a constructor argument and SHALL NOT call `getDb()` internally.

#### Scenario: Executors do not call getDb()
- **WHEN** any executor class method executes
- **THEN** the `Database` used is the one injected at construction, not a module-level singleton

### Requirement: All handler factories receive Database as first argument
All handler factory functions (`taskHandlers`, `boardHandlers`, `conversationHandlers`, `chatSessionHandlers`, etc.) SHALL accept a `Database` instance as their first argument. The `Database` SHALL be passed from `index.ts` where `getDb()` is called exactly once.

#### Scenario: getDb() called exactly once in index.ts
- **WHEN** the Bun process starts
- **THEN** `getDb()` is called exactly once in `index.ts` and the resulting `Database` instance is passed to all constructors and factory functions

### Requirement: tasks.list uses LEFT JOIN instead of correlated subquery
The `tasks.list` query SHALL use `LEFT JOIN executions ... GROUP BY tasks.id` to count executions instead of a correlated `(SELECT COUNT(*) FROM executions WHERE task_id = t.id)` subquery.

#### Scenario: Board load does not execute N correlated subqueries
- **WHEN** `tasks.list(boardId)` is called with N tasks on the board
- **THEN** exactly one SQL query executes (with a single JOIN pass), not N+1 queries

### Requirement: tasks.delete wrapped in db.transaction()
The `tasks.delete` operation SHALL wrap all its DELETE statements in a single `db.transaction()`.

#### Scenario: Task deletion is atomic
- **WHEN** `tasks.delete(taskId)` is called
- **THEN** all related rows (task, executions, conversation_messages, stream_events, etc.) are deleted in a single WAL transaction

### Requirement: Migration 032 adds compound indices
A new migration `032_perf_indices.ts` SHALL add compound indices:
- `executions(task_id, status, input_tokens)` — supports the fast path in `ContextEstimator`
- `tasks(board_id, workflow_state)` — supports position queries and column count checks

#### Scenario: Migration runs without errors on existing data
- **WHEN** migration `032_perf_indices.ts` runs against an existing database
- **THEN** all indices are created successfully without modifying any data
