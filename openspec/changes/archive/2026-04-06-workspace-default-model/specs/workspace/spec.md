## MODIFIED Requirements

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
