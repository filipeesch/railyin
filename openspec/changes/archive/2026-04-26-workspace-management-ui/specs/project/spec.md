## ADDED Requirements

### Requirement: Project git root can be auto-detected from project path
The system SHALL provide a backend endpoint that accepts a filesystem path and returns the Git repository root by running `git rev-parse --show-toplevel` at that path. The frontend SHALL call this endpoint when the user requests git root detection in the project form.

#### Scenario: Git root resolved from valid project path
- **WHEN** the frontend calls `workspace.resolveGitRoot` with a path inside a Git repository
- **THEN** the response contains `gitRoot` set to the absolute path of the repository root

#### Scenario: Git root not found for non-Git path
- **WHEN** the frontend calls `workspace.resolveGitRoot` with a path not inside any Git repository
- **THEN** the response contains `gitRoot: null`

## MODIFIED Requirements

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
