## ADDED Requirements

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
