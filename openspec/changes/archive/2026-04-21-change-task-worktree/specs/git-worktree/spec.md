## ADDED Requirements

### Requirement: Worktree can be created with user-supplied path and branch
The system SHALL support creating a worktree with a caller-provided path, branch name, and mode. When `options` are provided to `createWorktree`, the auto-computed path and branch name SHALL be replaced by the caller's values.

#### Scenario: New branch mode creates a branch from a source branch
- **WHEN** `createWorktree` is called with `mode: 'new'`, a custom `branchName`, a custom `path`, and a `sourceBranch`
- **THEN** `git worktree add -b <branchName> <path> <sourceBranch>` is executed

#### Scenario: Existing branch mode checks out without creating a new branch
- **WHEN** `createWorktree` is called with `mode: 'existing'`, a `branchName` matching an existing branch, and a custom `path`
- **THEN** `git worktree add <path> <branchName>` is executed (no `-b` flag)

#### Scenario: base_sha captured after creation regardless of mode
- **WHEN** `createWorktree` succeeds in either mode
- **THEN** `base_sha` is set to the HEAD commit of the newly created worktree

#### Scenario: Auto-computation used when no options provided
- **WHEN** `createWorktree` is called without `options` (e.g., from `triggerWorktreeIfNeeded`)
- **THEN** branch name and path are computed from the task title and `worktree_base_path` as before

### Requirement: Branch list can be retrieved for a task
The system SHALL expose a `listBranches(taskId)` function that returns all local and remote-tracking branch refs for the task's repository.

#### Scenario: Branches listed from git_root_path
- **WHEN** `listBranches` is called for a task with a valid `git_root_path`
- **THEN** `git branch -a --format=%(refname:short)` is executed from `git_root_path` and the result is returned as a string array

#### Scenario: HEAD symbolic ref is excluded
- **WHEN** the branch list output contains `HEAD` or `origin/HEAD`
- **THEN** those entries are filtered out of the returned array

#### Scenario: No git context returns empty array
- **WHEN** `listBranches` is called for a task with no `task_git_context` row
- **THEN** an empty array is returned without throwing

### Requirement: Manual worktree removal sets status to removed
The system SHALL update `worktree_status` to `removed` after a successful standalone worktree removal (not triggered by task deletion).

#### Scenario: Status set to removed on success
- **WHEN** `removeWorktree` is called standalone (not as part of `tasks.delete`)
- **THEN** `worktree_status` is set to `removed` in `task_git_context` and the task row is unaffected

### Requirement: Worktree auto-creation retries after manual removal
The system SHALL retry worktree creation in `triggerWorktreeIfNeeded` when `worktree_status` is `removed`, treating it the same as `error`.

#### Scenario: Removed worktree re-created on next transition
- **WHEN** a task whose `worktree_status` is `removed` transitions out of Backlog
- **THEN** `triggerWorktreeIfNeeded` creates a new worktree and sets status to `creating` then `ready`

## MODIFIED Requirements

### Requirement: Worktree status lifecycle is tracked
The system SHALL track worktree status through the following states: `not_created`, `creating`, `ready`, `error`, `removed`.

#### Scenario: Failed worktree creation sets error status
- **WHEN** `git worktree add` fails
- **THEN** `worktree_status` is set to `error` and the error message is surfaced to the caller

#### Scenario: Ready worktree enables execution
- **WHEN** `worktree_status` is `ready`
- **THEN** the worktree path is included in the execution payload and available to the agent

#### Scenario: Removed worktree allows re-creation
- **WHEN** `worktree_status` is `removed`
- **THEN** a new worktree can be created via `createWorktree` without error
