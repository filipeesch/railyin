## Purpose
Each task has at most one Git worktree, created when the task first leaves Backlog. The worktree provides an isolated working directory for the AI agent to read and modify files.

## Requirements

### Requirement: Each task has at most one Git worktree
The system SHALL associate at most one Git worktree with each task. The worktree is created when the task first leaves Backlog and enters an active workflow state. Tasks that remain in Backlog never have a worktree created.

#### Scenario: Worktree created on first active transition
- **WHEN** a task transitions out of Backlog for the first time
- **THEN** the system begins worktree creation and sets `worktree_status` to `creating`

#### Scenario: Worktree not created for Backlog tasks
- **WHEN** a task is created and remains in Backlog
- **THEN** no worktree is created and `worktree_status` remains `not_created`

#### Scenario: Subsequent executions reuse existing worktree
- **WHEN** a task already has a worktree with status `ready`
- **THEN** all further executions for that task use the same worktree path

### Requirement: Worktree is created outside the repository directory
The system SHALL create worktrees at a configurable path outside the repository to avoid nested Git structures. The default path pattern SHALL be `/worktrees/<project-id>/<task-id>/`.

#### Scenario: Worktree created at configured path
- **WHEN** a worktree is created for task `TASK-123` in project `partner-api`
- **THEN** the worktree is created at the configured base path, e.g., `/worktrees/partner-api/TASK-123/`

#### Scenario: Worktree base path is configurable
- **WHEN** `workspace.yaml` specifies a custom `worktree_base_path`
- **THEN** that path is used as the root for all worktree creation

### Requirement: Worktree branch is named after the task
The system SHALL create a branch for each task worktree using the pattern `task/<task-id>-<slugified-title>`. The branch is created from the project's `default_branch`.

#### Scenario: Branch name derived from task
- **WHEN** a worktree is created for a task titled "Add settlement exception filters" with ID `TASK-123`
- **THEN** the branch is named `task/task-123-add-settlement-exception-filters`

#### Scenario: Branch created from default branch
- **WHEN** a worktree is created
- **THEN** the branch is checked out from the project's `default_branch` (e.g., `main`)

### Requirement: Worktree supports monorepo projects
The system SHALL run `git worktree add` from `git_root_path` even when the task's project is a monorepo sub-project. The agent execution payload SHALL include both `project_path` and `git_root_path`.

#### Scenario: Worktree created from repo root in monorepo
- **WHEN** a task belongs to a project where `project_path != git_root_path`
- **THEN** `git worktree add` is executed from `git_root_path`

#### Scenario: Execution context includes both paths for monorepo
- **WHEN** an execution runs for a monorepo project task
- **THEN** the execution payload includes `project_path` and `git_root_path` so the agent can scope file changes to the correct subdirectory

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

### Requirement: Worktree is accessible to the AI via file tools
The system SHALL offer the AI model tools (`read_file`, `list_dir`, `run_command`) scoped to the worktree path when the worktree is in `ready` status, enabling the model to inspect and reason about project files during execution.

#### Scenario: Tools scoped to worktree root
- **WHEN** the model calls any file tool with a relative path
- **THEN** the path is resolved relative to the worktree root, and path traversal outside the worktree is blocked

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
