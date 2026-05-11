## Purpose
Defines the `config/engines.yaml` file format for declaring all available engine instances globally.

## Requirements

### Requirement: engines.yaml declares all engine instances globally
The system SHALL require a `config/engines.yaml` file that declares all available engine instances. Each entry SHALL have: `id` (string — unique identifier, equals the engine type in v1), `type` (one of `copilot`, `claude`, `opencode`, `scripted`, `pi`), and optional engine-specific fields (`model`, `providers`). The first entry in the list SHALL be the default engine used when no model is set on a conversation. When `engines.yaml` is absent or contains zero valid engine entries, the system SHALL refuse to start with a clear configuration error.

#### Scenario: engines.yaml is parsed at startup
- **WHEN** the application starts and `config/engines.yaml` exists
- **THEN** all engine entries are loaded and engine instances are constructed exactly once per entry

#### Scenario: First engine is the default
- **WHEN** `engines.yaml` lists copilot first and claude second
- **THEN** the default engine is copilot and new conversations without a model are assigned to copilot

#### Scenario: engines.yaml with opencode entry includes providers config
- **WHEN** `engines.yaml` has an opencode entry with a `providers` map
- **THEN** the OpenCode server is started with those provider credentials

#### Scenario: Missing engines.yaml errors at startup
- **WHEN** the application starts and `config/engines.yaml` does not exist
- **THEN** the loader returns a configuration error directing the user to `config/engines.yaml.sample`, and no engines are constructed

#### Scenario: engines.yaml with no valid entries errors at startup
- **WHEN** `config/engines.yaml` exists but its `engines:` list is empty or all entries lack `id`/`type`
- **THEN** the loader returns a configuration error and no engines are constructed

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
