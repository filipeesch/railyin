## Requirements

### Requirement: Common tools are task management handlers shared across all engines
The system SHALL extract shared tool handlers into a common module at src/bun/engine/common-tools.ts and SHALL register those tools uniformly across all engines. The shared tools SHALL include task tools create_task, edit_task, delete_task, move_task, message_task, get_task, list_tasks, and get_board_summary; todo tools create_todo, edit_todo, update_todo_status, list_todos, get_todo, and reorganize_todos; and interaction tool interview_me. For the Claude engine, those tools SHALL be registered through the Claude SDK while Claude built-in tools continue to own file, shell, search, edit, and agent operations.

#### Scenario: Common tools are available in native engine
- **WHEN** the native engine runs an execution in a column that includes interactions in its tools config
- **THEN** shared tools including interview_me are offered alongside native engine tools

#### Scenario: Common tools are available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** shared tools including interview_me are registered via mapped common tool definitions without engine-exclusive duplicates

#### Scenario: Common tools are available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** shared tools including interview_me are registered with the SDK and available for model calls

#### Scenario: Common tool execution returns consistent results across engines
- **WHEN** interview_me is called with questions and optional context from any engine
- **THEN** shared execution invokes a common interview callback contract and produces equivalent waiting-user behavior across engines

### Requirement: Common tool handlers receive a context object
Each common tool handler SHALL receive a CommonToolContext containing taskId, boardId, and execution callbacks required for shared behavior. The context SHALL include transition, human-turn, cancellation, and interview suspension callbacks so shared tools can trigger consistent orchestration outcomes across engines.

#### Scenario: Context populated by Copilot engine
- **WHEN** the Copilot engine executes a common tool call
- **THEN** it passes CommonToolContext including interview suspension callback to shared tool execution

#### Scenario: Context populated by Claude engine
- **WHEN** the Claude engine executes a common tool call
- **THEN** it passes CommonToolContext including interview suspension callback to shared tool execution

### Requirement: executeCommonTool returns a typed result object
The `executeCommonTool` function SHALL return `Promise<ToolExecutionResult>` where `ToolExecutionResult` is a discriminated union: `{ type: "result"; text: string }` for normal tool completions or `{ type: "suspend"; payload: string }` when the `interview_me` tool triggers execution suspension. Callers SHALL unwrap the `.text` field before treating the result as a plain string.

#### Scenario: Normal tool call returns result type
- **WHEN** a common tool (e.g. `create_todo`, `list_todos`) completes successfully
- **THEN** `executeCommonTool` resolves to `{ type: "result", text: "<json-string>" }`
- **THEN** callers can safely do `result.text` to get the serialized tool output

#### Scenario: interview_me triggers suspend type
- **WHEN** `interview_me` is called with questions
- **THEN** `executeCommonTool` resolves to `{ type: "suspend", payload: "<interview-payload>" }`
- **THEN** callers check `result.type === "suspend"` and handle the suspend path separately

### Requirement: Common tool handlers accept typed Record<string, unknown> args
All common tool handlers — including those in `board-tools.ts`, `lsp-tools.ts`, and `common-tools.ts` — SHALL accept `args: Record<string, unknown>` instead of `Record<string, string>`. Handlers SHALL cast to the expected type after AJV validation has confirmed the value is safe (e.g. `args.task_id as number`). The `toToolArgs()` serialisation helper SHALL be removed from both `engine/claude/tools.ts` and `engine/copilot/tools.ts`.

The test suite for `executeCommonTool` SHALL pass typed values (e.g. `{ task_id: 42 }` not `{ task_id: "42" }`) for all numeric, boolean, and array fields. Passing a string where a number is expected SHALL produce a validation error (not silently succeed).

The test migration SHALL:
- Replace `{ task_id: String(taskId) }` with `{ task_id: taskId }`
- Replace `{ number: "10" }` with `{ number: 10 }`
- Replace `{ items: JSON.stringify([...]) }` with `{ items: [...] }`
- Keep all existing pass/fail scenarios but update arg shapes

#### Scenario: Claude adapter passes raw args to executeCommonTool
- **WHEN** the Claude SDK invokes a common tool handler
- **THEN** the adapter passes the raw `Record<string, unknown>` args object directly to `executeCommonTool` without serialising to strings

#### Scenario: Copilot adapter passes raw args to executeCommonTool
- **WHEN** the Copilot engine invokes a common tool handler
- **THEN** the adapter passes the raw `Record<string, unknown>` args object directly to `executeCommonTool` without serialising to strings

#### Scenario: Board tool handler casts typed args safely
- **WHEN** a board tool (e.g. `execGetTask`) receives args that have passed AJV validation
- **THEN** it accesses numeric fields via `args.field as number` without parseInt and the correct value is used

#### Scenario: Typed task_id passes handler without cast errors
- **WHEN** `executeCommonTool("get_task", { task_id: 42 }, ctx)` is called
- **THEN** the handler receives `42` as a number and returns the task

#### Scenario: Typed status passes update_todo_status handler
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "done" }, ctx)` is called
- **THEN** the handler updates the todo and returns confirmation

#### Scenario: Typed items array passes reorganize_todos handler
- **WHEN** `executeCommonTool("reorganize_todos", { items: [{ id: 1, number: 10 }] }, ctx)` is called
- **THEN** the handler uses the array directly without JSON.parse and updates ordering

#### Scenario: Typed numeric arg passes to handler correctly
- **WHEN** `executeCommonTool("get_task", { task_id: 42 }, commonCtx())` is called
- **THEN** the handler receives `42` as a number and returns the task successfully

#### Scenario: String-typed numeric arg is rejected by validation
- **WHEN** `executeCommonTool("get_task", { task_id: "42" }, commonCtx())` is called
- **THEN** `executeCommonTool` returns a validation error mentioning `task_id` type mismatch

#### Scenario: update_todo_status with valid typed status succeeds
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "done" }, commonCtx())` is called
- **THEN** the todo is updated and the handler returns a success message

#### Scenario: update_todo_status with invalid status is rejected
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "finished" }, commonCtx())` is called
- **THEN** `executeCommonTool` returns an error naming `"finished"` and listing valid values

#### Scenario: reorganize_todos with real array succeeds
- **WHEN** `executeCommonTool("reorganize_todos", { items: [{ id: 1, number: 10 }] }, commonCtx())` is called
- **THEN** the handler processes the array without JSON.parse and returns the updated todo list

### Requirement: interview_me questions array has minItems: 1 constraint
The `interview_me` tool definition SHALL declare `minItems: 1` on the `questions` array property so that the AJV gate rejects empty arrays. The previous ad-hoc check (`questions.length === 0`) relied on runtime logic; the schema must encode this constraint so validation is schema-driven.

#### Scenario: Empty questions array is rejected by validator
- **WHEN** a model calls `interview_me` with `questions: []`
- **THEN** `executeCommonTool` returns an error message indicating at least one question is required, and the interview callback is NOT invoked

#### Scenario: questions array with one item passes validation
- **WHEN** a model calls `interview_me` with a well-formed single question
- **THEN** `executeCommonTool` proceeds to the interview callback

### Requirement: reorganize_todos items field accepts a typed array without JSON.parse fallback
The `reorganize_todos` handler SHALL accept `args.items` as a native array (`Array<{id: number; number: number}>`) without falling back to `JSON.parse`. After the `toToolArgs()` round-trip is removed, the SDK delivers the value as a real array; the handler SHALL cast directly to the expected type.

#### Scenario: items passed as real array is accepted
- **WHEN** a model calls `reorganize_todos` with `items: [{id: 1, number: 10}]`
- **THEN** the handler uses the array directly and the todo ordering is updated

### Requirement: update_todo_status status field has an explicit enum constraint
The `update_todo_status` tool definition SHALL declare `status` as an enum field with valid values `pending`, `in-progress`, `done`, `blocked`, and `deleted`. This makes the field self-documenting and enables the generic AJV validator to catch invalid values.

#### Scenario: Invalid status value is rejected by validator
- **WHEN** a model calls `update_todo_status` with `status: "finished"`
- **THEN** `executeCommonTool` returns `"Invalid value 'finished' for 'status'. Valid values: pending, in-progress, done, blocked, deleted"` without executing the handler

#### Scenario: Valid status value passes validation
- **WHEN** a model calls `update_todo_status` with `status: "done"`
- **THEN** `executeCommonTool` proceeds to execute the handler and the todo is updated

### Requirement: update_todo_status rejects invalid status values via validation gate
The `update_todo_status` tool definition's `status` property SHALL have an explicit `enum` that the AJV gate enforces before the handler is ever invoked. Tests SHALL verify this integration.

#### Scenario: Invalid status returns error without DB write (integration)
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "finished" }, ctx)` is called
- **THEN** the returned `text` MATCHES `/finished/` and the todo record is unchanged in the DB

#### Scenario: Valid status "deleted" passes gate
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "deleted" }, ctx)` is called
- **THEN** the validation gate passes and the handler soft-deletes the todo

### Requirement: execMoveTask applies three-case logic for on_enter_prompt
`execMoveTask` SHALL determine whether to defer or immediately fire `on_enter_prompt` based on whether the target task is the currently-executing task, whether it is already running, and whether the target column has an `on_enter_prompt`. The three cases are:

- **Case A** (`isSelf || isRunning`) AND target column has `on_enter_prompt`: set `needs_column_prompt = 1` on the moved task; do NOT call `ctx.onTransition`.
- **Case B** (!`isSelf` AND !`isRunning`) AND target column has `on_enter_prompt`: call `ctx.onTransition(movedTaskId, targetState)` which fires the prompt asynchronously.
- **Case C**: target column has no `on_enter_prompt`: update `workflow_state` and `position` only.

#### Scenario: Self-move to prompt column sets DB flag
- **WHEN** a running task calls `move_task` with its own task ID and the target column has `on_enter_prompt`
- **THEN** `needs_column_prompt` is set to `1` on the task
- **AND** `ctx.onTransition` is NOT called
- **AND** the tool returns `{ success: true, task_id, workflow_state }`

#### Scenario: Cross-task move, idle target, prompt column fires immediately
- **WHEN** task A calls `move_task` with task B's ID, task B is idle, and the target column has `on_enter_prompt`
- **THEN** `ctx.onTransition(taskBId, targetState)` is called
- **AND** the column prompt for task B starts asynchronously
- **AND** `needs_column_prompt` is NOT set on task B

#### Scenario: Cross-task move, running target, prompt column defers
- **WHEN** task A calls `move_task` with task B's ID, task B is running, and the target column has `on_enter_prompt`
- **THEN** `needs_column_prompt = 1` is set on task B
- **AND** `ctx.onTransition` is NOT called
- **AND** task B's current execution continues undisturbed

#### Scenario: Move to column without on_enter_prompt — no deferral
- **WHEN** `move_task` is called and the target column has no `on_enter_prompt`
- **THEN** `workflow_state` and `position` are updated
- **AND** `needs_column_prompt` is NOT modified
- **AND** `ctx.onTransition` is NOT called

### Requirement: CommonToolContext carries injected board tool executor
`CommonToolContext` (in `src/bun/engine/types.ts`) SHALL include a `boardTools: IBoardToolExecutor` field. The `executeCommonToolText` function in `common-tools.ts` SHALL dispatch board/task tool calls via `ctx.boardTools.*` instead of directly calling the free functions from `board-tools.ts`.

#### Scenario: Board tool dispatch uses injected executor
- **WHEN** `executeCommonToolText("get_task", args, ctx)` is called
- **THEN** it calls `ctx.boardTools.getTask(args, ctx)` — not the free function `execGetTask`

#### Scenario: CommonToolContext construction requires boardTools
- **WHEN** code constructs a `CommonToolContext` object
- **THEN** TypeScript requires a `boardTools` field of type `IBoardToolExecutor`

#### Scenario: Engine builds context with BoardToolExecutor
- **WHEN** `ClaudeEngine` or `CopilotEngine` builds a `CommonToolContext` for execution
- **THEN** it passes `new BoardToolExecutor(this.db, this.wsRepo)` as the `boardTools` field

### Requirement: execMessageTask onHumanTurn fires for idle target tasks
When `execMessageTask` is called and the target task has `execution_state != 'running'`, the system SHALL call `ctx.onHumanTurn(taskId, message)` to immediately start a human turn execution on the target task. The `ctx.onHumanTurn` callback SHALL be wired to `HumanTurnExecutor.execute()` via `ExecutionParams`.

#### Scenario: Message delivered immediately to idle task
- **WHEN** `message_task` is called targeting a task with `execution_state = 'idle'`
- **THEN** `ctx.onHumanTurn(taskId, message)` is called
- **AND** the target task starts a new human-turn execution with the message content
- **AND** the tool returns `{ status: "delivered", task_id }`

#### Scenario: Message queued when target is running (existing behavior unchanged)
- **WHEN** `message_task` is called targeting a task with `execution_state = 'running'`
- **THEN** the message is inserted into `pending_messages`
- **AND** `ctx.onHumanTurn` is NOT called
- **AND** the tool returns `{ status: "queued", task_id }`
