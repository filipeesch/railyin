## Purpose
Allows the user to abort an in-progress AI execution. Partial work and conversation history are kept; the task returns to `waiting_user` so the user can continue.

## Requirements

### Requirement: A running execution can be cancelled by the user
The system SHALL allow the user to cancel an in-progress AI execution. On cancellation, the orchestrator calls `engine.cancel(executionId)`, the execution is marked `cancelled`, partial conversation messages are retained, worktree file changes are kept, and the task returns to `waiting_user`. Cancellation works identically regardless of which engine is active.

#### Scenario: Cancel button visible when execution is running
- **WHEN** a task's `execution_state` is `running`
- **THEN** a Cancel button is visible in the task detail drawer

#### Scenario: Cancel button hidden when not running
- **WHEN** a task's `execution_state` is not `running`
- **THEN** no Cancel button is shown

#### Scenario: Cancellation routes through engine abstraction
- **WHEN** the user clicks Cancel
- **THEN** the orchestrator calls `engine.cancel(executionId)` on the active engine, aborts the AbortController, and updates the execution status to `cancelled` and `task.execution_state` to `waiting_user`

#### Scenario: Native engine cancellation aborts HTTP request
- **WHEN** the active engine is native and the user cancels
- **THEN** `NativeEngine.cancel()` aborts the in-flight AI HTTP request via the AbortSignal

#### Scenario: Copilot engine cancellation disconnects session
- **WHEN** the active engine is copilot and the user cancels
- **THEN** `CopilotEngine.cancel()` disconnects the active CopilotSession

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
