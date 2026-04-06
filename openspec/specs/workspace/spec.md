## Purpose
The workspace is the top-level container for all boards, projects, workflow templates, and AI provider configuration. It is a single-installation concept for MVP.

## Requirements

### Requirement: Workspace is the top-level container
The system SHALL maintain a single workspace per installation that acts as the root container for all boards, projects, workflow templates, and AI provider configuration.

#### Scenario: Workspace exists on first launch
- **WHEN** the application starts for the first time
- **THEN** a default workspace is created automatically with no boards or projects

#### Scenario: Workspace persists across sessions
- **WHEN** the application is closed and reopened
- **THEN** all boards, projects, and settings from the previous session are preserved

### Requirement: Workspace stores AI provider configuration
The workspace SHALL store AI provider settings including base URL, API key, and an optional `default_model` (fully-qualified `providerId/modelId`). These settings apply to all AI executions across all boards and tasks.

#### Scenario: AI provider configured via YAML
- **WHEN** the user edits `workspace.yaml` with valid provider config
- **THEN** all subsequent AI executions use those settings

#### Scenario: Missing AI configuration is detected at startup
- **WHEN** the application starts and `workspace.yaml` is missing or has an invalid `ai` section
- **THEN** the application displays a configuration error screen and does not attempt AI calls

#### Scenario: default_model loaded from workspace.yaml
- **WHEN** `workspace.yaml` contains `default_model: anthropic/claude-sonnet-4-5`
- **THEN** `LoadedConfig.workspace.default_model` equals `"anthropic/claude-sonnet-4-5"` after loading

#### Scenario: Missing default_model does not cause startup error
- **WHEN** `workspace.yaml` has no `default_model` field
- **THEN** the application starts successfully and `workspace.default_model` is `undefined`

### Requirement: Workspace schema includes workspace_id for future tenancy
The database schema SHALL include a `workspace_id` foreign key on boards and projects to support future multi-user deployments without schema migration.

#### Scenario: workspace_id is always set
- **WHEN** a board or project is created
- **THEN** it is assigned the current workspace ID (default: 1 for single-user installations)

### Requirement: Workspace config is hot-reloaded on demand
The system SHALL re-read `workspace.yaml` from disk and update all AI provider settings without restarting the application.

#### Scenario: Reload config reflects edited YAML
- **WHEN** the user edits `workspace.yaml` and clicks "Reload config" in the Setup view
- **THEN** all subsequent AI calls use the updated settings without restarting the app

#### Scenario: Invalid YAML on reload surfaces an error
- **WHEN** the user reloads config and `workspace.yaml` contains a parse error
- **THEN** an error message is shown in the Setup view and the previous valid configuration continues to apply

### Requirement: Default config files are created on first launch
The system SHALL auto-create `workspace.yaml` and the default workflow YAML when the config directory does not exist, so users can start without manual setup.

#### Scenario: Config directory created automatically
- **WHEN** the application starts and `~/.railyn/config/` does not exist
- **THEN** the directory and default config files are created with safe defaults (`provider: fake`)
