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
The system SHALL track worktree status through the following states: `not_created`, `creating`, `ready`, `failed`, `removed`.

#### Scenario: Failed worktree creation blocks execution
- **WHEN** `git worktree add` fails
- **THEN** `worktree_status` is set to `failed` and the task's `execution_state` is set to `failed` with an error message in the conversation

#### Scenario: Ready worktree enables execution
- **WHEN** `worktree_status` is `ready`
- **THEN** the worktree path is included in the execution payload and available to the agent

### Requirement: Worktree is accessible to the AI via file tools
The system SHALL offer the AI model tools (`read_file`, `list_dir`, `run_command`) scoped to the worktree path when the worktree is in `ready` status, enabling the model to inspect and reason about project files during execution.

#### Scenario: Tools scoped to worktree root
- **WHEN** the model calls any file tool with a relative path
- **THEN** the path is resolved relative to the worktree root, and path traversal outside the worktree is blocked
