## ADDED Requirements

### Requirement: Transition returns task with final execution state
After a workflow transition that triggers an AI execution, the `tasks.transition` RPC SHALL return a `task` object whose `executionState` reflects the fully-written DB state — including `execution_state = 'running'` and the correct `currentExecutionId` — rather than a snapshot taken before those writes complete.

#### Scenario: With-prompt transition returns running execution state
- **WHEN** `tasks.transition` is called for a column with `on_enter_prompt`
- **THEN** the returned `task.executionState` is `"running"` and `task.currentExecutionId` is the newly created execution's ID

#### Scenario: No-prompt transition returns idle execution state
- **WHEN** `tasks.transition` is called for a column without `on_enter_prompt`
- **THEN** the returned `task.executionState` is `"idle"` and `task.currentExecutionId` is null

#### Scenario: Board card badge reflects transition result immediately
- **WHEN** the frontend receives the `tasks.transition` response
- **THEN** the task card badge on the board shows the correct execution state without requiring a page refresh
