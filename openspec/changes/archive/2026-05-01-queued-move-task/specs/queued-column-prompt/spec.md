## Purpose
When a task is moved to a column with an `on_enter_prompt` while its execution is already running (or while it is performing a self-move via the `move_task` tool), the column prompt SHALL be deferred until the current execution ends rather than starting a second execution on top of a live one.

## Requirements

### Requirement: Column move while running defers on_enter_prompt
When a task with `execution_state = 'running'` is moved to a column with an `on_enter_prompt` (via drag-and-drop, drawer column select, or the `move_task` tool for a self-move), the system SHALL update `workflow_state` immediately, set `needs_column_prompt = 1` on the task, and NOT start a new execution. The deferred prompt SHALL fire once the current execution reaches its terminal state.

#### Scenario: Human move while running — card moves, badge stays Running
- **WHEN** a user drags a running task to a column that has an `on_enter_prompt`
- **THEN** `workflow_state` is updated to the target column immediately
- **AND** `needs_column_prompt` is set to `1`
- **AND** no new execution is created
- **AND** the task card shows the task in the new column with `execution_state = 'running'`

#### Scenario: Human move while running — prompt fires after execution ends
- **WHEN** the running execution for a task with `needs_column_prompt = 1` reaches a terminal state (`completed`, `failed`, `cancelled`, `waiting_user`)
- **THEN** `needs_column_prompt` is cleared to `0`
- **AND** `TransitionExecutor.execute()` is called for the task's current `workflow_state`
- **AND** the column's `on_enter_prompt` is fired as a new execution

#### Scenario: Human move while running — no prompt column, no deferral
- **WHEN** a user moves a running task to a column that has NO `on_enter_prompt`
- **THEN** only `workflow_state` is updated; `needs_column_prompt` remains `0`
- **AND** no deferred action is scheduled

#### Scenario: AI self-move defers on_enter_prompt
- **WHEN** a running task's AI execution calls `move_task` targeting its own task ID and the target column has an `on_enter_prompt`
- **THEN** `workflow_state` is updated immediately and `needs_column_prompt = 1` is set
- **AND** the currently executing AI turn continues to completion
- **AND** the column prompt fires after the AI turn ends

#### Scenario: needs_column_prompt is backend-only
- **WHEN** any tasks RPC returns a Task object
- **THEN** the `Task` payload does NOT include a `needs_column_prompt` field
