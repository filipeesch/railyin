## MODIFIED Requirements

### Requirement: Project is a registered folder
The system SHALL allow users to register, edit, and delete projects through the Setup view UI without editing `workspace.yaml` directly. A project may be the root of a standalone Git repository or a subfolder within a monorepo. An optional `railyin.yaml` file at the project root MAY define run profiles and tool launchers for tasks belonging to that project. A project MUST reside inside the workspace's `workspace_path` folder; registration of paths outside the workspace is rejected.

#### Scenario: Standalone repository registered
- **WHEN** a user registers a folder where `project_path == git_root_path` and the path is inside `workspace_path`
- **THEN** the project is saved with both paths stored as relative paths in `workspace.yaml`, resolved to absolute paths at runtime

#### Scenario: Monorepo sub-project registered
- **WHEN** a user registers a folder where `project_path` is a subdirectory of `git_root_path` and both are inside `workspace_path`
- **THEN** the project stores both paths as relative values in `workspace.yaml`, and `project.subPath` (the relative path from git root to project) is pre-computed at config load time

#### Scenario: Project has railyin.yaml at project root
- **WHEN** a `railyin.yaml` file exists at `project_path`
- **THEN** the system can read launch profiles and tools from it for tasks belonging to this project

#### Scenario: Existing project edited via UI
- **WHEN** the user opens the project edit dialog, modifies fields, and saves
- **THEN** the project entry in `workspace.yaml` is updated with relative paths without re-registering

#### Scenario: Project deleted via UI
- **WHEN** the user confirms deletion of a project
- **THEN** the project is removed from `workspace.yaml` and all associated tasks are deleted from the database

### Requirement: Project stores git root and project path as relative paths
The system SHALL store `project_path` and `git_root_path` as relative paths (relative to `workspace_path`) in `workspace.yaml`. The config loader SHALL resolve them to absolute paths at load time. All consumers of `LoadedProject` receive absolute paths. A `subPath` field (the relative path from `gitRootPath` to `projectPath`) SHALL be pre-computed on `LoadedProject` at load time for use by the working directory resolver.

#### Scenario: Config loader resolves relative paths to absolute
- **WHEN** `workspace.yaml` contains `project_path: packages/ui` and `workspace_path: /home/alice/repos`
- **THEN** `LoadedProject.projectPath` equals `/home/alice/repos/packages/ui` at runtime

#### Scenario: Git root path resolved to absolute
- **WHEN** `workspace.yaml` contains `git_root_path: myrepo` and `workspace_path: /home/alice/repos`
- **THEN** `LoadedProject.gitRootPath` equals `/home/alice/repos/myrepo` at runtime

#### Scenario: subPath pre-computed for monorepo project
- **WHEN** a monorepo project has `git_root_path: myrepo` and `project_path: myrepo/packages/ui`
- **THEN** `LoadedProject.subPath` equals `packages/ui`

#### Scenario: subPath is empty string for standalone repo
- **WHEN** a project has `project_path` equal to `git_root_path`
- **THEN** `LoadedProject.subPath` equals `""` (empty string)

#### Scenario: Absolute path in project_path rejected at config load
- **WHEN** `workspace.yaml` contains an absolute path for `project_path` (e.g. `/home/alice/repos/myapp`)
- **THEN** config loading fails with an error message that includes the found value and a migration hint showing the relative equivalent

#### Scenario: Missing workspace_path with projects defined
- **WHEN** `workspace.yaml` defines one or more projects but `workspace_path` is not set
- **THEN** config loading fails with an error stating that `workspace_path` is required when projects are defined

### Requirement: Project git root can be auto-detected from project path
The system SHALL provide a backend endpoint that accepts a filesystem path and returns the Git repository root by running `git rev-parse --show-toplevel` at that path. The frontend SHALL call this endpoint when the user requests git root detection in the project form.

#### Scenario: Git root resolved from valid project path
- **WHEN** the frontend calls `workspace.resolveGitRoot` with a path inside a Git repository
- **THEN** the response contains `gitRoot` set to the absolute path of the repository root

#### Scenario: Git root not found for non-Git path
- **WHEN** the frontend calls `workspace.resolveGitRoot` with a path not inside any Git repository
- **THEN** the response contains `gitRoot: null`

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
