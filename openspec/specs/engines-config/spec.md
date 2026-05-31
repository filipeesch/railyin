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
- **THEN** the config loader succeeds and `PiEngineConfig.sampling_presets` defaults to empty / `default_sampling_preset` defaults to undefined
