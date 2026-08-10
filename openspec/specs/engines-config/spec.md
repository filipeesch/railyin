## Purpose
Defines the `engines.yaml` file format for declaring all available engine instances globally, and the UI for editing it.

## Requirements

### Requirement: engines.yaml declares all engine instances globally
The system SHALL require a `config/engines.yaml` file that declares all available engine instances. The file MUST be located in the global config directory (`~/.railyn/config/engines.yaml`). The system SHALL NOT read `engines.yaml` from any workspace-specific directory; workspace-dir copies are silently ignored. Each entry SHALL have: `id` (string — unique identifier, equals the engine type in v1), `type` (one of `copilot`, `claude`, `opencode`, `scripted`, `pi`), and optional engine-specific fields (`model`, `providers`). The first entry in the list SHALL be the default engine used when no model is set on a conversation. When `engines.yaml` is absent or contains zero valid engine entries, the system SHALL refuse to start with a clear configuration error.

#### Scenario: engines.yaml is parsed at startup from global config dir
- **WHEN** the application starts and `~/.railyn/config/engines.yaml` exists
- **THEN** all engine entries are loaded and engine instances are constructed exactly once per entry

#### Scenario: First engine is the default
- **WHEN** `engines.yaml` lists copilot first and claude second
- **THEN** the default engine is copilot and new conversations without a model are assigned to copilot

#### Scenario: engines.yaml with opencode entry includes providers config
- **WHEN** `engines.yaml` has an opencode entry with a `providers` map
- **THEN** the OpenCode server is started with those provider credentials

#### Scenario: Missing engines.yaml errors at startup
- **WHEN** the application starts and `~/.railyn/config/engines.yaml` does not exist
- **THEN** the loader returns a configuration error directing the user to `config/engines.yaml.sample`, and no engines are constructed

#### Scenario: engines.yaml with no valid entries errors at startup
- **WHEN** `~/.railyn/config/engines.yaml` exists but its `engines:` list is empty or all entries lack `id`/`type`
- **THEN** the loader returns a configuration error and no engines are constructed

#### Scenario: Workspace-dir engines.yaml is silently ignored
- **WHEN** `~/.railyn/workspaces/default/engines.yaml` exists but `~/.railyn/config/engines.yaml` does not
- **THEN** the loader returns a configuration error (missing global engines.yaml) — the workspace-dir file is not read

### Requirement: UI — Engines editor accessible from settings gear icon

The settings gear icon in the board header SHALL present a popup menu with two items: **Setup** (navigates to `/setup`) and **Engines** (opens the engines YAML editor).

The engines editor SHALL:
- Open as a full-screen overlay pre-populated with the live contents of `~/.railyn/config/engines.yaml`
- Provide real-time YAML validation and disable the Save button while the YAML is invalid
- Display a note that changes take effect after restarting Railyin
- Write back to `~/.railyn/config/engines.yaml` on save and invalidate the in-memory config cache

RPCs required:
- `config.getEnginesYaml` — reads engines.yaml from the global config dir
- `config.saveEnginesYaml` — validates YAML, writes file, invalidates config cache

### Requirement: Pi engine entry supports sampling_presets and default_sampling_preset
The `engines.yaml` format for Pi engine entries SHALL accept two new optional fields: `sampling_presets` (a map of preset name to sampling parameter object) and `default_sampling_preset` (a string naming the default preset). Each preset object MAY contain any subset of: `temperature` (number), `top_p` (number), `top_k` (number), `presence_penalty` (number). The `config/engines.yaml.sample` file SHALL be updated to document these fields with example presets.

#### Scenario: engines.yaml.sample documents sampling_presets with examples
- **WHEN** a user reads `config/engines.yaml.sample`
- **THEN** they find a commented Pi engine example showing `sampling_presets` with at least two named presets and `default_sampling_preset` referencing one of them

#### Scenario: Pi engine entry with sampling fields parses without error
- **WHEN** `engines.yaml` contains a Pi entry with `sampling_presets: { balanced: { temperature: 0.8 } }` and `default_sampling_preset: balanced`
- **THEN** the config loader constructs a valid `PiEngineConfig` with `sampling_presets` and `default_sampling_preset` populated

#### Scenario: Omitting sampling fields remains valid
- **WHEN** `engines.yaml` has a Pi entry with no `sampling_presets` or `default_sampling_preset` fields
- **THEN** the config loader succeeds and `PiEngineConfig.sampling_presets` defaults to empty / `default_sampling_preset` defaults to undefined### Requirement: Engine display name is declared in engines.yaml
Engine entries in `engines.yaml` SHALL support an optional `name` field (string) that serves as the human-readable display label for that engine. When `name` is absent, the system SHALL fall back to the engine type label (defined in a frontend mapping table) and then to the engine `id`.

#### Scenario: Engine with name field is parsed
- **WHEN** `engines.yaml` contains an engine entry with `name: My Pi Engine`
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
