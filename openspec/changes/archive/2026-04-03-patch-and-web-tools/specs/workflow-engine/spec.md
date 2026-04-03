## ADDED Requirements

### Requirement: web tool group provides URL fetch and internet search tools
The system SHALL define a `web` tool group containing `fetch_url` and `search_internet`. The group SHALL be available for use in workflow column `tools` arrays. `fetch_url` SHALL always execute regardless of configuration. `search_internet` SHALL self-disable gracefully when not configured.

#### Scenario: web group resolves to fetch_url and search_internet
- **WHEN** a column's `tools` array contains `"web"`
- **THEN** `resolveToolsForColumn` expands it to `["fetch_url", "search_internet"]`

### Requirement: workspace.yaml supports a search configuration block
The system SHALL support an optional `search` block in `workspace.yaml` with fields `engine` (string) and `api_key` (string). When absent, search-dependent tools SHALL degrade gracefully.

#### Scenario: Search config loaded from workspace.yaml
- **WHEN** `workspace.yaml` contains a `search` block with engine and api_key
- **THEN** the loaded config exposes `workspace.search.engine` and `workspace.search.api_key`

#### Scenario: Missing search block does not cause startup error
- **WHEN** `workspace.yaml` has no `search` block
- **THEN** the application starts successfully and `workspace.search` is undefined

## MODIFIED Requirements

### Requirement: Workflow columns are defined in YAML configuration
The system SHALL load workflow column definitions from YAML files. Each column definition SHALL include at minimum an `id`, `label`, and optionally an `on_enter_prompt`, `stage_instructions`, and `tools`. The `tools` array SHALL accept built-in group names (`read`, `write`, `search`, `web`, `shell`, `interactions`, `agents`) and individual tool names interchangeably — both resolve to tool definitions.

#### Scenario: Columns load from YAML at startup
- **WHEN** the application starts
- **THEN** workflow templates are read from YAML files and available for board assignment

#### Scenario: Column without on_enter_prompt is valid
- **WHEN** a column is defined in YAML without an `on_enter_prompt`
- **THEN** tasks moved into that column have their `execution_state` set to `idle` and no AI call is made

#### Scenario: Column tools config with group name resolves to all tools in that group
- **WHEN** a column's `tools` array contains a group name (e.g. `write`)
- **THEN** `resolveToolsForColumn` expands it to all tool definitions belonging to that group

#### Scenario: Column tools config with individual name still works
- **WHEN** a column's `tools` array contains an individual tool name (e.g. `read_file`)
- **THEN** `resolveToolsForColumn` includes that specific tool definition as before

#### Scenario: Mixed group and individual names are both resolved
- **WHEN** a column's `tools` array contains both group names and individual tool names
- **THEN** `resolveToolsForColumn` expands groups and includes individual tools, deduplicating if a tool appears in both

## RENAMED Requirements

### Requirement: ask_me suspends execution and prompts the user for input
FROM: `ask_user suspends execution and prompts the user for input`
TO: `ask_me suspends execution and prompts the user for input`
