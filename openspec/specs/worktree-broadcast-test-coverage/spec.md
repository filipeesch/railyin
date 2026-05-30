## Requirements

### Requirement: Stream processor broadcast includes worktreePath
The `StreamProcessor` SHALL pass a `Task` with non-null `worktreePath` to its `onTaskUpdated` callback when the task has a `task_git_context` row with `worktree_path` set.

#### Scenario: SP-GC-1 — worktreePath preserved after execution end
- **WHEN** a task has a `task_git_context` row with `worktree_path = "/wt/1"` and `worktree_status = "ready"` and an execution completes
- **THEN** the `Task` argument passed to `onTaskUpdated` has `worktreePath === "/wt/1"`

#### Scenario: SP-GC-2 — worktreePath is null when no git context exists
- **WHEN** a task has no `task_git_context` row and an execution completes
- **THEN** the `Task` argument passed to `onTaskUpdated` has `worktreePath === null`

### Requirement: Transition executor no-prompt return includes worktreePath
The `TransitionExecutor` SHALL return a `Task` with non-null `worktreePath` from its `transition()` method when the target column has no `on_enter_prompt` and the task has a `task_git_context` row.

#### Scenario: TE-GC-1 — no-prompt transition return has worktreePath
- **WHEN** a task has a `task_git_context` row with `worktree_path = "/wt/1"` and `tasks.transition` is called for a column without `on_enter_prompt`
- **THEN** the returned `task.worktreePath === "/wt/1"`

### Requirement: Retry executor return includes worktreePath
The `RetryExecutor` SHALL return a `Task` with non-null `worktreePath` from its `retry()` method when the task has a `task_git_context` row.

#### Scenario: RE-GC-1 — retry return task has worktreePath
- **WHEN** a task has a `task_git_context` row with `worktree_path = "/wt/1"` and `retry()` is called
- **THEN** the returned `task.worktreePath === "/wt/1"`

### Requirement: HumanTurnExecutor broadcasts include worktreePath
The `HumanTurnExecutor` SHALL pass a `Task` with non-null `worktreePath` to its `onTaskUpdated` callback across all three execution paths: resume from `waiting_user`, session-lost fallback, and new execution start.

#### Scenario: HT-GC-1 — resume waiting_user broadcast has worktreePath
- **WHEN** a task is in `waiting_user` state, has a `task_git_context` row with `worktree_path = "/wt/1"`, and a user message is sent to resume
- **THEN** the `Task` argument passed to `onTaskUpdated` has `worktreePath === "/wt/1"`

#### Scenario: HT-GC-2 — session-lost fallback broadcast has worktreePath
- **WHEN** the engine session is lost, the task has a `task_git_context` row with `worktree_path = "/wt/1"`, and a new execution is started via the fallback path
- **THEN** the `Task` argument passed to `onTaskUpdated` has `worktreePath === "/wt/1"`

#### Scenario: HT-GC-3 — new execution start broadcast has worktreePath
- **WHEN** a new human-turn execution starts and the task has a `task_git_context` row with `worktree_path = "/wt/1"`
- **THEN** the `Task` argument passed to `onTaskUpdated` has `worktreePath === "/wt/1"`

### Requirement: Frontend store preserves worktreePath on task update
The frontend task store SHALL store non-null `worktreePath` when `onTaskUpdated` is called with a task carrying a non-null `worktreePath`.

#### Scenario: T-WT-1 — onTaskUpdated stores worktreePath correctly
- **WHEN** `onTaskUpdated` is called with a task where `worktreePath = "/wt/1"` and `executionState = "completed"`
- **THEN** `taskIndex[task.id].worktreePath === "/wt/1"`

### Requirement: Terminal and Code Server buttons survive task.updated push
The Task Drawer SHALL keep the Terminal and Code Server buttons visible after a `task.updated` WebSocket push when the pushed task retains a non-null `worktreePath`.

#### Scenario: WS-WT-1 — buttons disappear when task.updated nulls worktreePath (regression sentinel)
- **WHEN** a task drawer is open with Terminal and Code Server buttons visible (task has `worktreePath = "/wt/1"`)
- **AND** a `task.updated` push arrives with `{ ...task, executionState: "completed", worktreePath: null }`
- **THEN** the Terminal button (`pi-desktop`) is no longer visible

#### Scenario: WS-WT-2 — buttons remain when task.updated preserves worktreePath
- **WHEN** a task drawer is open with Terminal and Code Server buttons visible (task has `worktreePath = "/wt/1"`)
- **AND** a `task.updated` push arrives with `{ ...task, executionState: "completed", worktreePath: "/wt/1" }`
- **THEN** the Terminal button (`pi-desktop`) remains visible
- **AND** the Code Server button (`pi-code`) remains visible
