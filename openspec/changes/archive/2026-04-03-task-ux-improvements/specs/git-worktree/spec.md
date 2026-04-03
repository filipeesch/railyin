## ADDED Requirements

### Requirement: Worktree can be removed for a task
The system SHALL expose a `removeWorktree(taskId)` function that removes the registered worktree directory using `git worktree remove --force`. Errors SHALL be logged but SHALL NOT throw, to allow callers to proceed with deletion even when the worktree directory is missing or corrupt.

#### Scenario: Worktree directory removed when ready
- **WHEN** `removeWorktree` is called for a task whose `worktree_status` is `ready`
- **THEN** `git worktree remove --force <worktree_path>` is executed

#### Scenario: No-op when worktree not created
- **WHEN** `removeWorktree` is called for a task whose `worktree_status` is `not_created`
- **THEN** no git command is run and the function returns successfully

#### Scenario: Error logged but not thrown on removal failure
- **WHEN** `git worktree remove --force` exits with a non-zero status
- **THEN** the error is logged to console and the function returns without throwing
