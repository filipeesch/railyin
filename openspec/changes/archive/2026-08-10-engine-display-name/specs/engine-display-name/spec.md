## ADDED Requirements

### Requirement: Engine display name is declared in engines.yaml
Engine entries in `engines.yaml` SHALL support an optional `name` field (string) that serves as the human-readable display label for that engine. When `name` is absent, the system SHALL fall back to the engine type label (defined in a frontend mapping table) and then to the engine `id`.

#### Scenario: Engine with name field is parsed
- **WHEN** `engines.yaml` contains `- id: pi-local` with a `name: My Pi Engine` field
- **THEN** the config loader stores the name and makes it available through the engine entry

#### Scenario: Engine without name falls back to type label
- **WHEN** `engines.yaml` contains an engine with `type: copilot` but no `name` field
- **THEN** the frontend displays the type-based fallback label ("GitHub Copilot")

#### Scenario: Fallback chain when both name and type map are absent
- **WHEN** an engine has neither a `name` field nor a matching entry in the type label map
- **THEN** the frontend displays the engine `id` as the label

### Requirement: Engine name is propagated to the frontend
The backend SHALL include the engine `name` (when present) in the `WorkspaceConfig.availableEngines` array returned by the `workspace.getConfig` RPC. The frontend type for `availableEngines` SHALL extend each entry with an optional `name` field.

#### Scenario: Available engines RPC includes name field
- **WHEN** `workspace.getConfig` is called and an engine entry has a `name` field in `engines.yaml`
- **THEN** the `availableEngines` response includes `{ id, type, name }` with the name value

#### Scenario: Available engines RPC omits name when absent
- **WHEN** an engine entry in `engines.yaml` has no `name` field
- **THEN** the `availableEngines` response includes `{ id, type }` with no name key (or name: undefined)

### Requirement: Workspace setup page uses engine name as display label
The engine checkboxes on the workspace setup page (`/setup`) SHALL display the engine name as the label text. When no name is declared, the system SHALL use the type-based fallback label, then the engine id.

#### Scenario: Setup page shows engine name when present
- **WHEN** the workspace setup page renders engine checkboxes
- **THEN** each checkbox label shows the engine name from `engines.yaml` (e.g., "My Pi Engine")

#### Scenario: Setup page falls back to type label when name is absent
- **WHEN** an engine in `engines.yaml` has no `name` field
- **THEN** the checkbox label falls back to the type-based label (e.g., "Pi")

### Requirement: Model picker group headers use engine name
The conversation model picker dropdown SHALL use the engine name as the group header label when multiple engines are configured. When no name is declared, the system SHALL fall back to the engine id.

#### Scenario: Model picker shows engine name as group header
- **WHEN** the model picker dropdown is open and multiple engines are configured
- **THEN** each engine group header displays the engine name (e.g., "GitHub Copilot" instead of "copilot")

#### Scenario: Model picker falls back to engine id when name is absent
- **WHEN** an engine has no `name` field declared
- **THEN** the group header falls back to the engine id (e.g., "pi-local")

### Requirement: Documentation reflects new name field
The `config/engines.yaml.sample` file SHALL include an example engine entry that demonstrates the `name` field alongside `id` and `type`.

#### Scenario: Sample file documents the name field
- **WHEN** a user reads `config/engines.yaml.sample`
- **THEN** they find at least one engine example showing the `name` field
