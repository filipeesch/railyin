## ADDED Requirements

### Requirement: Workspace is the top-level container
The system SHALL maintain a single workspace per installation that acts as the root container for all boards, projects, workflow templates, and AI provider configuration.

#### Scenario: Workspace exists on first launch
- **WHEN** the application starts for the first time
- **THEN** a default workspace is created automatically with no boards or projects

#### Scenario: Workspace persists across sessions
- **WHEN** the application is closed and reopened
- **THEN** all boards, projects, and settings from the previous session are preserved

### Requirement: Workspace stores AI provider configuration
The workspace SHALL store AI provider settings including base URL, API key, and model name. These settings apply to all AI executions across all boards and tasks.

#### Scenario: AI provider configured via YAML
- **WHEN** the user edits `workspace.yaml` with a valid `ai.base_url`, `ai.api_key`, and `ai.model`
- **THEN** all subsequent AI executions use those settings

#### Scenario: Missing AI configuration is detected at startup
- **WHEN** the application starts and `workspace.yaml` is missing or has an invalid `ai` section
- **THEN** the application displays a configuration error screen and does not attempt AI calls

### Requirement: Workspace schema includes workspace_id for future tenancy
The database schema SHALL include a `workspace_id` foreign key on boards and projects to support future multi-user deployments without schema migration.

#### Scenario: workspace_id is always set
- **WHEN** a board or project is created
- **THEN** it is assigned the current workspace ID (default: 1 for single-user installations)
