## ADDED Requirements

### Requirement: TaskGitContextRepository is tested in isolation
The test suite SHALL verify `TaskGitContextRepository` using an in-memory SQLite DB, covering all read and write operations without any git subprocesses.

#### Scenario: upsertContext creates row with not_created status
- **WHEN** `upsertContext(taskId, gitRootPath)` is called for a task with no existing row
- **THEN** a row exists in `task_git_context` with `worktree_status = 'not_created'` and the correct `git_root_path`

#### Scenario: upsertContext updates path without resetting status
- **WHEN** `upsertContext(taskId, newPath)` is called for a task whose existing row has `worktree_status = 'ready'`
- **THEN** `git_root_path` is updated to `newPath` and `worktree_status` remains `'ready'`

#### Scenario: getContext returns null when no row exists
- **WHEN** `getContext(taskId)` is called for a task with no `task_git_context` row
- **THEN** the result is `null`

#### Scenario: getContext returns full row when it exists
- **WHEN** `upsertContext` is called then `getContext(taskId)` is called
- **THEN** the returned object contains `taskId`, `gitRootPath`, and `worktreeStatus`

### Requirement: ProjectResolver is tested with config layer
The test suite SHALL verify `ProjectResolver` using `setupTestConfig` to avoid real filesystem config reads.

#### Scenario: getDefaultBranch returns configured value
- **WHEN** workspace YAML has `default_branch: develop` and `projectResolver.getDefaultBranch(wsKey, projectKey)` is called
- **THEN** the result is `"develop"`

#### Scenario: getDefaultBranch falls back to main
- **WHEN** workspace YAML has no `default_branch` and `projectResolver.getDefaultBranch(wsKey, projectKey)` is called
- **THEN** the result is `"main"`

#### Scenario: getWorktreeBasePath returns configured path
- **WHEN** workspace YAML has `worktree_base_path: /tmp/custom-wt` and `projectResolver.getWorktreeBasePath(wsKey, projectKey, gitRootPath)` is called
- **THEN** the result is `"/tmp/custom-wt"`

#### Scenario: getWorktreeBasePath falls back to adjacent directory
- **WHEN** workspace YAML has no `worktree_base_path` and `getWorktreeBasePath(wsKey, projectKey, "/some/repo")` is called
- **THEN** the result is `"/some/repo/../worktrees"`

### Requirement: GitRepositoryManager is tested with real git repos
The test suite SHALL verify `GitRepositoryManager` using real temporary git repositories, without any DB or config dependencies.

#### Scenario: addWorktree creates a new-branch worktree from sourceBranch
- **WHEN** `addWorktree(gitRoot, "task/1-foo", worktreePath, "main")` is called on a repo where `main` exists
- **THEN** a worktree directory exists at `worktreePath` and `git -C worktreePath rev-parse HEAD` equals `git -C gitRoot rev-parse main`

#### Scenario: addWorktree in existing-branch mode checks out without -b
- **WHEN** `addWorktree(gitRoot, "existing-branch", worktreePath, undefined, "existing")` is called
- **THEN** the worktree is created at `worktreePath` on `existing-branch` without attempting to create a new branch

#### Scenario: addWorktree throws when gitRootPath does not exist
- **WHEN** `addWorktree("/nonexistent", ...)` is called
- **THEN** the call rejects with an error

#### Scenario: listBranches returns branch names without HEAD entries
- **WHEN** a repo has branches `main` and `feature/x` and `listBranches(gitRoot)` is called
- **THEN** the result includes `"main"` and `"feature/x"` and does not include any string containing `"HEAD"`

#### Scenario: revParseHead returns the current commit SHA
- **WHEN** `revParseHead(worktreePath)` is called
- **THEN** the result is a 40-character SHA string matching the HEAD commit

#### Scenario: removeWorktree removes the worktree from git
- **WHEN** a worktree exists and `removeWorktree(gitRoot, worktreePath)` is called
- **THEN** the directory at `worktreePath` no longer appears in `git worktree list`

### Requirement: WorktreeManager is tested with injected IProjectResolver stub
The test suite SHALL verify `WorktreeManager` using a stub `IProjectResolver` (plain object implementing the interface) so tests do not read workspace.yaml from disk.

#### Scenario: registerContext creates task_git_context row
- **WHEN** `worktreeManager.registerContext(taskId, gitDir)` is called
- **THEN** a `task_git_context` row exists with `worktree_status = 'not_created'` and `git_root_path = gitDir`

#### Scenario: registerContext updates path without resetting status
- **WHEN** a task already has `worktree_status = 'ready'` and `registerContext` is called with a new path
- **THEN** `git_root_path` is updated and `worktree_status` remains `'ready'`

#### Scenario: triggerWorktreeIfNeeded does nothing when no row exists
- **WHEN** `triggerWorktreeIfNeeded(taskId)` is called for a task with no `task_git_context` row
- **THEN** no status callbacks are invoked and no git subprocesses run

#### Scenario: triggerWorktreeIfNeeded does nothing when status is ready
- **WHEN** `task_git_context.worktree_status = 'ready'` and `triggerWorktreeIfNeeded(taskId)` is called
- **THEN** no status callbacks are invoked

#### Scenario: triggerWorktreeIfNeeded creates worktree and sets status ready
- **WHEN** `task_git_context.worktree_status = 'not_created'` and `triggerWorktreeIfNeeded(taskId)` is called
- **THEN** `worktree_status` becomes `'ready'` and status callbacks include "creating worktree" and "ready"

#### Scenario: triggerWorktreeIfNeeded sets worktree_path under configured base
- **WHEN** `worktreeManager.triggerWorktreeIfNeeded(taskId)` completes successfully
- **THEN** `task_git_context.worktree_path` starts with the path returned by `IProjectResolver.getWorktreeBasePath`

#### Scenario: triggerWorktreeIfNeeded retries after error status
- **WHEN** `task_git_context.worktree_status = 'error'` and `triggerWorktreeIfNeeded(taskId)` is called
- **THEN** a new worktree is created and status becomes `'ready'`

#### Scenario: triggerWorktreeIfNeeded throws and sets error when git root invalid
- **WHEN** `task_git_context.git_root_path` points to a non-existent directory
- **THEN** `triggerWorktreeIfNeeded(taskId)` rejects with an error containing "does not exist" and `worktree_status` becomes `'error'`

### Requirement: Auto-created worktree uses project defaultBranch not HEAD
The test suite SHALL include a regression test that verifies the core bug fix: HEAD state of the git root has no effect on the base of an auto-created worktree branch.

#### Scenario: Worktree branches from defaultBranch when HEAD is diverged
- **WHEN** the git root's HEAD is on a branch other than `main` (e.g. `feature/diverged`) and `triggerWorktreeIfNeeded(taskId)` is called with a stub `IProjectResolver` returning `"main"` for `getDefaultBranch`
- **THEN** the commit at `HEAD` inside the newly created worktree equals the commit at `main` in the git root, NOT the commit at `feature/diverged`

#### Scenario: Explicit sourceBranch overrides defaultBranch
- **WHEN** `createWorktree(taskId, { ..., sourceBranch: "feature/custom" })` is called explicitly
- **THEN** the worktree is created from `feature/custom`, not from `IProjectResolver.getDefaultBranch`

### Requirement: task-git handler tests use injected WorktreeManager
The test suite SHALL verify `task-git.ts` handlers by constructing `WorktreeManager` with stubs and injecting it via the handler factory — no direct imports from `worktree.ts`.

#### Scenario: listBranches returns empty when no context row
- **WHEN** `tasks.listBranches` is invoked for a task with no `task_git_context` row
- **THEN** the result is `{ branches: [] }`

#### Scenario: getChangedFiles returns empty when worktree not ready
- **WHEN** `tasks.getChangedFiles` is invoked and `worktree_status` is `'not_created'`
- **THEN** the result is `[]`

#### Scenario: getChangedFiles returns untracked files when worktree is ready
- **WHEN** a worktree exists on disk, `worktree_status = 'ready'`, and an untracked file is added
- **THEN** `tasks.getChangedFiles` returns a list containing that filename
