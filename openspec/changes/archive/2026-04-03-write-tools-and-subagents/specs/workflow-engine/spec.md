## MODIFIED Requirements

### Requirement: Workflow columns are defined in YAML configuration
The system SHALL load workflow column definitions from YAML files. Each column definition SHALL include at minimum an `id`, `label`, and optionally an `on_enter_prompt`, `stage_instructions`, and `tools`. The `tools` array SHALL accept built-in group names (`read`, `write`, `search`, `shell`, `interactions`, `agents`) and individual tool names interchangeably — both resolve to tool definitions.

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

## ADDED Requirements

### Requirement: run_command blocks shell write redirection
The system SHALL extend the `run_command` block-list to reject commands containing shell write redirections (`>`, `>>`) or piped write commands (e.g. `tee`), so that file writes are channelled exclusively through the explicit write tools where path safety is enforced.

#### Scenario: Redirect operator is blocked
- **WHEN** an agent calls `run_command` with a command containing `>`
- **THEN** the tool returns an error and no file is written

#### Scenario: tee command is blocked
- **WHEN** an agent calls `run_command` with a command containing `tee`
- **THEN** the tool returns an error and no file is written
