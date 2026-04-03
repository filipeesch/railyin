## MODIFIED Requirements

### Requirement: Entering a column triggers on_enter_prompt execution
The system SHALL automatically execute a column's `on_enter_prompt` when a task enters that column, if the prompt is configured. Before starting the execution, the engine SHALL update the task's `model` field to the column's configured `model`, or the workspace default if the column has none.

#### Scenario: Prompt runs on column entry
- **WHEN** a task is moved to a column with a configured `on_enter_prompt`
- **THEN** a new execution is created, `execution_state` is set to `running`, and the prompt begins executing immediately

#### Scenario: No prompt means idle state
- **WHEN** a task is moved to a column with no `on_enter_prompt`
- **THEN** `execution_state` is set to `idle` and no execution is created

#### Scenario: Task model updated to column model on entry
- **WHEN** a task enters a column with a `model` field defined
- **THEN** `task.model` is set to the column's model before execution begins

#### Scenario: Task model reset to workspace default when column has no model
- **WHEN** a task enters a column with no `model` field
- **THEN** `task.model` is set to the workspace `ai.model` value

## ADDED Requirements

### Requirement: Execution supports abort-signal-based cancellation
The engine SHALL maintain an in-memory `Map<executionId, AbortController>`. When a `tasks.cancel` request is received, the controller for the current execution is aborted. The engine catches the abort and transitions the execution to `cancelled` and the task to `waiting_user`.

#### Scenario: AbortController registered at execution start
- **WHEN** a new execution begins (transition or human turn)
- **THEN** an AbortController is registered in the map keyed by `executionId`

#### Scenario: AbortController removed on execution completion
- **WHEN** an execution finishes normally (completed, failed, waiting_user)
- **THEN** the AbortController for that execution is removed from the map

#### Scenario: Abort signal propagated to AI fetch
- **WHEN** `controller.abort()` is called
- **THEN** the in-flight AI HTTP request (streaming or non-streaming) receives the abort signal and terminates early

#### Scenario: Stale running state reset on startup
- **WHEN** the Bun process restarts with tasks in `execution_state = 'running'`
- **THEN** those tasks are reset to `execution_state = 'failed'` (existing restart-recovery behaviour, unchanged)
