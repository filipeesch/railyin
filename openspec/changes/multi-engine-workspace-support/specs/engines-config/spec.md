## ADDED Requirements

### Requirement: engines.yaml declares all engine instances globally
The system SHALL support a `config/engines.yaml` file that declares all available engine instances. Each entry SHALL have: `id` (string — unique identifier, equals the engine type in v1), `type` (one of `copilot`, `claude`, `opencode`, `scripted`), and optional engine-specific fields (`model`, `providers`). The first entry in the list SHALL be the default engine used when no model is set on a conversation.

#### Scenario: engines.yaml is parsed at startup
- **WHEN** the application starts and `config/engines.yaml` exists
- **THEN** all engine entries are loaded and engine instances are constructed exactly once per entry

#### Scenario: First engine is the default
- **WHEN** `engines.yaml` lists copilot first and claude second
- **THEN** the default engine is copilot and new conversations without a model are assigned to copilot

#### Scenario: engines.yaml with opencode entry includes providers config
- **WHEN** `engines.yaml` has an opencode entry with a `providers` map
- **THEN** the OpenCode server is started with those provider credentials

### Requirement: Backward compatibility when engines.yaml is absent
When `config/engines.yaml` does not exist, the system SHALL fall back to reading the `engine:` block from `workspace.yaml` and treating it as a single-entry engine list. All existing workspace configurations SHALL continue to work without modification.

#### Scenario: No engines.yaml falls back to workspace.yaml engine block
- **WHEN** `config/engines.yaml` does not exist AND `workspace.yaml` has `engine: { type: copilot }`
- **THEN** a single CopilotEngine instance is created and used for all workspaces, identical to current behavior

#### Scenario: Both files present — engines.yaml wins
- **WHEN** both `config/engines.yaml` and `workspace.yaml engine:` block exist
- **THEN** `engines.yaml` is used and the `engine:` block in `workspace.yaml` is ignored

### Requirement: workspace.yaml supports optional allowed_engines filter
Each workspace definition in `workspace.yaml` MAY include an `allowed_engines` list of engine IDs. When present, only the listed engines SHALL be available in that workspace. When absent, all engines from `engines.yaml` SHALL be available.

#### Scenario: allowed_engines restricts visible engines
- **WHEN** workspace A declares `allowed_engines: [copilot]` and engines.yaml has copilot and opencode
- **THEN** `listModels()` for workspace A returns only copilot models

#### Scenario: No allowed_engines means all engines available
- **WHEN** workspace B declares no `allowed_engines`
- **THEN** `listModels()` for workspace B returns models from all engines in engines.yaml

#### Scenario: Invalid engine ID in allowed_engines is ignored with warning
- **WHEN** `allowed_engines` references an engine ID not present in engines.yaml
- **THEN** a startup warning is logged and the unknown ID is silently skipped
