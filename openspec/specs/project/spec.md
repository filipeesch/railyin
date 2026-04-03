## Purpose
Projects represent registered Git repositories (or monorepo sub-folders) that tasks are scoped to. All Git operations use the project's stored paths.

## Requirements

### Requirement: Project is a registered folder
The system SHALL allow users to register a folder as a project. A project may be the root of a standalone Git repository or a subfolder within a monorepo.

#### Scenario: Standalone repository registered
- **WHEN** a user registers a folder where `project_path == git_root_path`
- **THEN** the project is saved with both paths set to the same value

#### Scenario: Monorepo sub-project registered
- **WHEN** a user registers a folder where `project_path` is a subdirectory of `git_root_path`
- **THEN** the project stores both paths independently, allowing Git operations at the repo root

### Requirement: Project stores git root and project path independently
The system SHALL store `project_path` and `git_root_path` as separate fields. All Git operations (branch creation, worktree management) SHALL use `git_root_path`. Agent execution context SHALL include both paths.

#### Scenario: Git operations run from git root
- **WHEN** a worktree is created for a task belonging to a monorepo project
- **THEN** the `git worktree add` command runs from `git_root_path`, not `project_path`

#### Scenario: Execution payload includes both paths
- **WHEN** an execution is triggered for a task in a monorepo project
- **THEN** the payload includes both `projectPath` and `gitRootPath` so the agent can scope changes correctly

### Requirement: Project requires a default branch
Each project SHALL store a `default_branch` field used as the base for new task branches and worktrees.

#### Scenario: Worktree branches from default branch
- **WHEN** a task's worktree is created
- **THEN** the worktree branch is created from the project's `default_branch`

### Requirement: Task belongs to exactly one project
The system SHALL enforce that each task is associated with exactly one project. This association cannot be changed after task creation.

#### Scenario: Task created under a project
- **WHEN** a user creates a task on a board
- **THEN** the user must select one of the board's linked projects to own the task

#### Scenario: Task project cannot be changed
- **WHEN** a task already exists
- **THEN** the system does not provide a mechanism to reassign it to a different project
