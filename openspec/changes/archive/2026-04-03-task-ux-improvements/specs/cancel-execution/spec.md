## ADDED Requirements

### Requirement: A running execution can be cancelled by the user
The system SHALL allow the user to cancel an in-progress AI execution. On cancellation, the execution is marked `cancelled`, partial conversation messages are retained, worktree file changes are kept, and the task returns to `waiting_user`.

#### Scenario: Cancel button visible when execution is running
- **WHEN** a task's `execution_state` is `running`
- **THEN** a Cancel button is visible in the task detail drawer

#### Scenario: Cancel button hidden when not running
- **WHEN** a task's `execution_state` is not `running`
- **THEN** no Cancel button is shown

#### Scenario: Execution marked cancelled on user cancel
- **WHEN** the user clicks Cancel
- **THEN** the current execution's status is set to `cancelled` in the database and `task.execution_state` transitions to `waiting_user`

#### Scenario: Partial conversation messages retained after cancel
- **WHEN** an execution is cancelled mid-way
- **THEN** all conversation messages produced before cancellation (tool calls, tool results, partial assistant text) remain visible in the conversation timeline

#### Scenario: Worktree changes retained after cancel
- **WHEN** an execution is cancelled and the AI had already written files to the worktree
- **THEN** those file changes remain on disk; they are not reverted

#### Scenario: User can continue by sending a new message after cancel
- **WHEN** a task is in `waiting_user` following a cancellation
- **THEN** the user can send a new chat message to start a new execution from the current state

### Requirement: cancelled is a valid execution state
The system SHALL recognise `cancelled` as a valid value for `ExecutionState` (both in `executions.status` and `task.execution_state`). It SHALL be distinct from `failed`.

#### Scenario: Cancelled task shown with secondary badge
- **WHEN** `task.execution_state` is `cancelled`
- **THEN** the task card displays a "Cancelled" badge with secondary severity
