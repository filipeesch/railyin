## ADDED Requirements

### Requirement: Async worktree preparation
The system SHALL allow worktree creation to happen asynchronously after task transition.

#### Scenario: Prepare worktree async
- **WHEN** task transitions to a state with on_enter_prompt
- **THEN** RPC returns immediately
- **THEN** worktree creation happens in background
- **THEN** execution starts when worktree is ready

### Requirement: Preparing state
The system SHALL track worktree preparation progress via `preparing` execution state.

#### Scenario: Task shows preparing state
- **WHEN** worktree preparation starts
- **THEN** task execution_state is set to `"preparing"`
- **THEN** UI receives `task.updated` notification
- **THEN** progress indicator is shown to user

### Requirement: Execution handoff
The system SHALL trigger execution automatically after worktree preparation completes.

#### Scenario: Worktree ready → execution starts
- **WHEN** worktree preparation succeeds
- **THEN** callback interface is notified
- **THEN** execution starts with `onPrepared(taskId, result)`
- **THEN** task state transitions to `"running"`

### Requirement: Failure handling
The system SHALL handle worktree preparation failures gracefully.

#### Scenario: Worktree creation fails
- **WHEN** worktree creation fails
- **THEN** callback interface is called with `onFailed(taskId, error)`
- **THEN** task state transitions to `"failed"`
- **THEN** error message is pushed via WebSocket
