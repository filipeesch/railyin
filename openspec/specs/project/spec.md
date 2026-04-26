## Purpose
Projects represent registered Git repositories (or monorepo sub-folders) that tasks are scoped to. All Git operations use the project's stored paths.

## Requirements

### Requirement: Project is a registered folder
The system SHALL allow users to register, edit, and delete projects through the Setup view UI without editing `workspace.yaml` directly. A project may be the root of a standalone Git repository or a subfolder within a monorepo. An optional `railyin.yaml` file at the project root MAY define run profiles and tool launchers for tasks belonging to that project.

#### Scenario: Standalone repository registered
- **WHEN** a user registers a folder where `project_path == git_root_path`
- **THEN** the project is saved with both paths set to the same value

#### Scenario: Monorepo sub-project registered
- **WHEN** a user registers a folder where `project_path` is a subdirectory of `git_root_path`
- **THEN** the project stores both paths independently, allowing Git operations at the repo root

#### Scenario: Project has railyin.yaml at project root
- **WHEN** a `railyin.yaml` file exists at `project_path`
- **THEN** the system can read launch profiles and tools from it for tasks belonging to this project

#### Scenario: Existing project edited via UI
- **WHEN** the user opens the project edit dialog, modifies fields, and saves
- **THEN** the project entry in `workspace.yaml` is updated without re-registering

#### Scenario: Project deleted via UI
- **WHEN** the user confirms deletion of a project
- **THEN** the project is removed from `workspace.yaml` and all associated tasks are deleted from the database

### Requirement: Project git root can be auto-detected from project path
The system SHALL provide a backend endpoint that accepts a filesystem path and returns the Git repository root by running `git rev-parse --show-toplevel` at that path. The frontend SHALL call this endpoint when the user requests git root detection in the project form.

#### Scenario: Git root resolved from valid project path
- **WHEN** the frontend calls `workspace.resolveGitRoot` with a path inside a Git repository
- **THEN** the response contains `gitRoot` set to the absolute path of the repository root

#### Scenario: Git root not found for non-Git path
- **WHEN** the frontend calls `workspace.resolveGitRoot` with a path not inside any Git repository
- **THEN** the response contains `gitRoot: null`

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
