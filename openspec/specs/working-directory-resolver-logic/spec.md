## ADDED Requirements

### Requirement: WorkingDirectoryResolver resolves worktree path for single-repo tasks
`WorkingDirectoryResolver.resolve(task)` SHALL return `worktree_path` when the task's git context has `worktree_status = "ready"` and `project_path` equals `git_root_path`.

#### Scenario: Worktree ready, single-repo
- **WHEN** the task has `worktree_status = "ready"`, `worktree_path = "/wt"`, `git_root_path = "/proj"`, and `project_path = "/proj"`
- **THEN** `resolve()` returns `"/wt"`

### Requirement: WorkingDirectoryResolver appends monorepo sub-path to worktree
`WorkingDirectoryResolver.resolve(task)` SHALL compute `relative(git_root_path, project_path)` and append it to `worktree_path` when the task has a ready worktree and `project_path` differs from `git_root_path`.

#### Scenario: Worktree ready, monorepo sub-path
- **WHEN** the task has `worktree_status = "ready"`, `worktree_path = "/wt"`, `git_root_path = "/repo"`, and `project_path = "/repo/packages/app"`
- **THEN** `resolve()` returns `"/wt/packages/app"`

### Requirement: WorkingDirectoryResolver throws when project_path is outside git_root_path
`WorkingDirectoryResolver.resolve(task)` SHALL throw with a descriptive error referencing both paths when `relative(git_root_path, project_path)` produces a `"../"` prefix — indicating the project lives outside the git repository.

#### Scenario: project_path outside gitRootPath throws
- **WHEN** `git_root_path = "/repo"` and `project_path = "/other/dir"` (not a child of `/repo`)
- **THEN** `resolve()` throws an error whose message contains `"outside gitRootPath"`

### Requirement: WorkingDirectoryResolver falls back to project_path when no ready worktree
`WorkingDirectoryResolver.resolve(task)` SHALL return `project_path` when the task has no ready worktree (`worktree_status != "ready"` or `worktree_path` is null) and a configured `project_path` is available.

#### Scenario: No worktree, project_path available
- **WHEN** `worktree_status = "not_created"` and `project_path = "/proj"`
- **THEN** `resolve()` returns `"/proj"`

### Requirement: WorkingDirectoryResolver falls back to worktree_path when project_path is unconfigured
`WorkingDirectoryResolver.resolve(task)` SHALL return `worktree_path` when the task has a ready worktree but no configured `project_path` (e.g., the project key is not found in workspace config).

#### Scenario: No project_path configured, worktree ready
- **WHEN** `worktree_status = "ready"`, `worktree_path = "/wt"`, and no `project_path` is configured for the task's project key
- **THEN** `resolve()` returns `"/wt"`
