## ADDED Requirements

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
