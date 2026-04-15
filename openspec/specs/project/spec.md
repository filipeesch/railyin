## Purpose
Projects represent registered Git repositories (or monorepo sub-folders) that tasks are scoped to. All Git operations use the project's stored paths.

## Requirements

### Requirement: Project is a registered folder
The system SHALL allow users to register a folder as a project. A project may be the root of a standalone Git repository or a subfolder within a monorepo. An optional `railyin.yaml` file at the project root MAY define run profiles and tool launchers for tasks belonging to that project.

#### Scenario: Standalone repository registered
- **WHEN** a user registers a folder where `project_path == git_root_path`
- **THEN** the project is saved with both paths set to the same value

#### Scenario: Monorepo sub-project registered
- **WHEN** a user registers a folder where `project_path` is a subdirectory of `git_root_path`
- **THEN** the project stores both paths independently, allowing Git operations at the repo root

#### Scenario: Project has railyin.yaml at project root
- **WHEN** a `railyin.yaml` file exists at `project_path`
- **THEN** the system can read launch profiles and tools from it for tasks belonging to this project

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
The system SHALL enforce that each task is associated with exactly one project. This association is stored as `project_key TEXT` — the string key of the project within its workspace — and cannot be changed after task creation.

#### Scenario: Task created under a project
- **WHEN** a user creates a task on a board
- **THEN** the user must select one of the board's linked projects to own the task and the task row stores the project's string key

#### Scenario: Task project cannot be changed
- **WHEN** a task already exists
- **THEN** the system does not provide a mechanism to reassign it to a different project

#### Scenario: Task row carries project_key
- **WHEN** a task is queried
- **THEN** the `project_key` column contains the string key of the owning project (e.g. `"my-app"`) not a hash-derived integer
