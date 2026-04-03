## MODIFIED Requirements

### Requirement: Task has two independent state dimensions
Each task SHALL maintain two distinct state fields: `workflow_state` representing its position in the board workflow, and `execution_state` representing the operational status of the current execution within that column. These states are updated independently. Valid `execution_state` values are: `idle`, `running`, `waiting_user`, `waiting_external`, `failed`, `completed`, and `cancelled`.

#### Scenario: Workflow state updates immediately on transition
- **WHEN** a user moves a task to a new column
- **THEN** `workflow_state` updates immediately to the target column's ID before any execution begins

#### Scenario: Execution state reflects operational status
- **WHEN** the on_enter_prompt execution for a column completes with status `waiting_user`
- **THEN** `execution_state` becomes `waiting_user` while `workflow_state` remains the current column

#### Scenario: Both states displayed together
- **WHEN** a task card is shown on the board
- **THEN** both `workflow_state` (column) and `execution_state` (badge) are visible simultaneously

#### Scenario: Cancelled execution reflected on task
- **WHEN** a running execution is cancelled
- **THEN** `execution_state` transitions to `waiting_user` (via the transient `cancelled` execution status)

## ADDED Requirements

### Requirement: Task stores a model override
Each task SHALL have an optional `model` field that overrides the workspace-level model for all AI executions run in the context of that task.

#### Scenario: Task model used when set
- **WHEN** a task has a non-null `model` field and an execution is triggered
- **THEN** the AI provider is created with the task's model value

#### Scenario: Workspace model used when task model is null
- **WHEN** a task's `model` field is null
- **THEN** the workspace-level `ai.model` is used for all executions

### Requirement: Task exposes git context fields
The `Task` domain type SHALL include `worktreeStatus`, `branchName`, and `worktreePath` populated from `task_git_context`.

#### Scenario: Git context fields available on Task
- **WHEN** a task is fetched via any tasks RPC
- **THEN** the returned Task object includes `worktreeStatus`, `branchName`, and `worktreePath` (nullable if not yet set)
