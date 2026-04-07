## MODIFIED Requirements

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
