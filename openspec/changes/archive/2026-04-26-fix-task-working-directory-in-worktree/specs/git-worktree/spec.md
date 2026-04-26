## MODIFIED Requirements

### Requirement: Worktree supports monorepo projects
The system SHALL run `git worktree add` from `git_root_path` even when the task's project is a monorepo sub-project. When a worktree is `ready`, the working directory passed to the execution engine SHALL be `join(worktree_path, relative(git_root_path, project_path))`. For single-repo projects where `project_path == git_root_path`, the working directory SHALL be `worktree_path` directly.

#### Scenario: Worktree created from repo root in monorepo
- **WHEN** a task belongs to a project where `project_path != git_root_path`
- **THEN** `git worktree add` is executed from `git_root_path`

#### Scenario: Agent working directory uses worktree root for single-repo tasks
- **WHEN** a task has a ready worktree and `project_path == git_root_path`
- **THEN** the execution engine receives `worktree_path` as `workingDirectory`

#### Scenario: Agent working directory preserves sub-path for monorepo tasks
- **WHEN** a task has a ready worktree, `project_path = /repo/packages/app`, and `git_root_path = /repo`
- **THEN** the execution engine receives `worktree_path + "/packages/app"` as `workingDirectory`

#### Scenario: Agent working directory uses projectPath before worktree is ready
- **WHEN** a task has `worktree_status = not_created` (e.g. task still in Backlog)
- **THEN** the execution engine receives `project_path` as `workingDirectory`

#### Scenario: Misconfigured projectPath outside gitRootPath raises error
- **WHEN** `project_path` does not start with `git_root_path` (e.g. they point to unrelated directories)
- **THEN** `_resolveWorkingDirectory` throws with a descriptive error rather than producing a path-traversal escape
