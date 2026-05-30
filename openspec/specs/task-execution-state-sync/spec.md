## Purpose
Defines how the `tasks.transition` RPC ensures the returned task object reflects the fully-written execution state, so the frontend can immediately show accurate badge and execution information after a workflow transition.

## Requirements

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


### Requirement: Task broadcasts include complete git-context fields
All `task.updated` WebSocket broadcasts SHALL include the full git-context fields (`worktreePath`, `worktreeStatus`, `branchName`) fetched from `task_git_context`. The broadcast SHALL NOT be built from a query that omits the `LEFT JOIN task_git_context` join, even if the primary purpose of the event is to reflect execution state changes.

#### Scenario: Execution-end broadcast preserves worktree path
- **WHEN** an AI execution completes and `stream-processor.ts` fires `task.updated`
- **THEN** the broadcast task object contains `worktreePath` equal to the stored `task_git_context.worktree_path` (not null) if a worktree exists

#### Scenario: Human-turn resume broadcast preserves worktree path
- **WHEN** a human-turn execution transitions to `waiting_user` and broadcasts `task.updated`
- **THEN** the broadcast task object contains `worktreePath` equal to the stored `task_git_context.worktree_path` (not null) if a worktree exists

#### Scenario: No-prompt transition broadcast preserves worktree path
- **WHEN** `tasks.transition` is called for a column without `on_enter_prompt` and the response task is built
- **THEN** the returned and broadcast task object contains `worktreePath` equal to the stored `task_git_context.worktree_path` (not null) if a worktree exists
