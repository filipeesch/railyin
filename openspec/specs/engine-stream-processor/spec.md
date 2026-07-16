## Purpose
Manages the lifecycle of AI engine stream consumption, write buffer coordination, and database persistence for executions.

## Requirements

### Requirement: StreamProcessor receives Database via constructor injection
The `StreamProcessor` class SHALL accept a `Database` instance as a constructor argument. It SHALL NOT call `getDb()` internally.

#### Scenario: Database injected at construction
- **WHEN** `new StreamProcessor(db, convBuffer, rawBuffer, ...)` is called
- **THEN** the instance uses the provided `Database` for all queries and does not import or call `getDb()`

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
The `tasks.delete` operation SHALL wrap all its DELETE statements in a single `db.transaction()`, and SHALL additionally delete the task's conversation file, sidecar, and any per-execution debug log files from disk if the conversation is file-backed. The file deletion SHALL happen outside the SQL transaction (after it commits), since filesystem operations are not part of the SQLite transaction.

#### Scenario: Task deletion is atomic in SQL
- **WHEN** `tasks.delete(taskId)` is called
- **THEN** all related SQL rows (task, executions, conversation_messages for legacy conversations, decision_records, etc.) are deleted in a single WAL transaction

#### Scenario: File-backed conversation's files are removed after the SQL transaction commits
- **WHEN** `tasks.delete(taskId)` is called for a task whose conversation is file-backed
- **THEN** after the SQL transaction commits, the conversation's `.jsonl`, `.meta.json`, and debug log files are deleted from disk

### Requirement: Migration 032 adds compound indices
A new migration `032_perf_indices.ts` SHALL add compound indices:
- `executions(task_id, status, input_tokens)` — supports the fast path in `ContextEstimator`
- `tasks(board_id, workflow_state)` — supports position queries and column count checks

#### Scenario: Migration runs without errors on existing data
- **WHEN** migration `032_perf_indices.ts` runs against an existing database
- **THEN** all indices are created successfully without modifying any data

### Requirement: StreamProcessor owns AbortController lifecycle
The `StreamProcessor` class SHALL be the single owner of the `abortControllers` map. It SHALL expose `createSignal(executionId: number): AbortSignal` to register a new controller and return its signal, and `abort(executionId: number): void` to trigger cancellation.

#### Scenario: Signal created before execution params are built
- **WHEN** any executor starts a new execution
- **THEN** it calls `streamProcessor.createSignal(executionId)` first and passes the returned signal to `ExecutionParamsBuilder.build()`

#### Scenario: Abort cleans up the map
- **WHEN** `StreamProcessor.consume()` reaches its `finally` block
- **THEN** the `abortControllers` entry for that executionId is deleted

#### Scenario: Orchestrator cancel delegates abort
- **WHEN** `Orchestrator.cancel(executionId)` is called
- **THEN** it calls `streamProcessor.abort(executionId)` to trigger the signal before performing DB writes

### Requirement: StreamProcessor encapsulates stream consumption
The `StreamProcessor` class SHALL expose a `runNonNative(taskId, conversationId, executionId, engine, params)` method that starts an engine execution and consumes the resulting stream, handling all DB persistence and callback relay.

#### Scenario: Token accumulation and final flush
- **WHEN** the stream emits `token` events followed by a `done` event
- **THEN** all token content is accumulated and persisted as a single `assistant` conversation message on `done`

#### Scenario: Reasoning flush before tool_start
- **WHEN** a `tool_start` event is received while `reasoningAccum` is non-empty
- **THEN** the reasoning content is flushed as a `reasoning` message before the tool call is persisted

#### Scenario: Cancellation flushes accumulators
- **WHEN** the abort signal fires mid-stream
- **THEN** any accumulated token and reasoning content is flushed to DB before the execution is marked `cancelled`

#### Scenario: Fatal error transitions to failed
- **WHEN** the stream emits `{ type: "error", fatal: true }`
- **THEN** the execution status is set to `failed` and task execution_state is set to `failed`

### Requirement: rawMessageSeq is owned by StreamProcessor
The `StreamProcessor` class SHALL own the `rawMessageSeq` map used for ordering raw model message inserts, and SHALL clean it up in the `finally` block of `consume()`.

#### Scenario: Sequence is cleaned up after execution
- **WHEN** `consume()` completes (success, error, or cancel)
- **THEN** the `rawMessageSeq` entry for that executionId is deleted from the map

### Requirement: ESP-1 `tasks.list` returns correct execution count
After the correlated subquery → `LEFT JOIN + GROUP BY` fix, `tasks.list` must return an accurate `executionCount` for each task.

#### Scenario: Task with N executions shows count N
- **GIVEN** a task with 3 executions
- **WHEN** `tasks.list` is called
- **THEN** the returned task has `executionCount = 3`

#### Scenario: Task with no executions shows count 0
- **GIVEN** a task with no executions
- **WHEN** `tasks.list` is called
- **THEN** the returned task has `executionCount = 0`

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

### Requirement: StreamProcessor finally block drains needs_column_prompt before pending_messages
When a task execution reaches its terminal state, the `StreamProcessor.consume()` finally block SHALL:
1. Check `needs_column_prompt` on the task row. If set, clear it and fire `transitionExecutor.execute()` asynchronously (non-blocking).
2. Only if `needs_column_prompt` was NOT set, check `pending_messages` for the task and drain each queued message via `humanTurnExecutor.execute()`.

The two drains are mutually exclusive per execution end. Column prompt takes priority because it establishes the task's new execution context; pending messages are delivered after the column prompt execution ends.

#### Scenario: needs_column_prompt fires on execution end
- **WHEN** a task execution ends with `needs_column_prompt = 1` on the task row
- **THEN** `needs_column_prompt` is set to `0`
- **AND** `transitionExecutor.execute(taskId, task.workflow_state)` is called (fires column prompt)
- **AND** `pending_messages` drain is NOT run in the same finally block

#### Scenario: pending_messages drained when no column prompt pending
- **WHEN** a task execution ends with `needs_column_prompt = 0` and there are rows in `pending_messages` for the task
- **THEN** each pending message is delivered via `humanTurnExecutor.execute()` in insertion order
- **AND** the `pending_messages` rows for the task are deleted

#### Scenario: No drain when both flags absent
- **WHEN** a task execution ends with `needs_column_prompt = 0` and no `pending_messages` rows
- **THEN** the finally block behaves as before — only `onTaskUpdated` is called with the final task state

#### Scenario: TransitionExecutor and HumanTurnExecutor injected into StreamProcessor
- **WHEN** `new StreamProcessor(db, ..., transitionExecutor, humanTurnExecutor)` is called
- **THEN** the instance uses the provided executors for drain operations and does not construct them internally

### Requirement: Tool call parent block assignment ignores reasoningBlockId
The stream processor SHALL assign `parentBlockId` for `tool_call` and `tool_result` stream events using only `event.parentCallId ?? null`. It SHALL NOT fall back to `reasoningBlockId` when `event.parentCallId` is absent.

#### Scenario: Top-level tool call has null parent
- **WHEN** a `tool_call` event has no `parentCallId` and a prior reasoning block exists
- **THEN** the emitted stream event has `parentBlockId: null` (not the reasoning block id)

#### Scenario: Subagent tool call preserves its parentCallId
- **WHEN** a `tool_call` event has `parentCallId` set to the spawning tool's callId
- **THEN** the emitted stream event has `parentBlockId` equal to that callId

#### Scenario: Tool result parent matches tool call parent
- **WHEN** a `tool_result` event is emitted for a top-level tool
- **THEN** its `parentBlockId` is `null`, not the reasoning block id

### Requirement: worktreePath is threaded to display builder functions
The stream processor SHALL pass the execution's `worktreePath` (when available) to `translateCopilotStream`, `translateClaudeMessage`, and any other display builder invocations, so that absolute paths in tool subjects can be relativized.

#### Scenario: Bash subject uses relative path when worktreePath is provided
- **WHEN** a bash tool call subject contains an absolute path starting with the worktreePath
- **THEN** the emitted `ToolCallDisplay.subject` uses the relative path instead
