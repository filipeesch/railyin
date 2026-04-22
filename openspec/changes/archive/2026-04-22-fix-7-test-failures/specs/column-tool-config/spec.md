## MODIFIED Requirements

### Requirement: Workflow columns declare available tools
The system SHALL support an optional `tools` array in each workflow column definition. When present, only the named tools SHALL be offered to the model. When absent, the system SHALL fall back to the default tool set (`read_file`, `list_dir`, `run_command`). Group names (e.g., `todos`, `web`, `write`) SHALL expand to their constituent tool definitions. Every group name in `TOOL_GROUPS` SHALL resolve to at least one tool definition — groups with no registered definitions are a configuration error.

#### Scenario: Column with tools list restricts model to named tools
- **WHEN** a column defines `tools: [read_file, ask_user]`
- **THEN** the AI request for that column includes only the `read_file` and `ask_user` tool definitions

#### Scenario: Column without tools key uses default set
- **WHEN** a column definition does not include a `tools` key
- **THEN** the AI request includes the default tool set (`read_file`, `list_dir`, `run_command`) if a worktree is available

#### Scenario: Empty tools array means no tools
- **WHEN** a column defines `tools: []`
- **THEN** the AI request includes no tool definitions

#### Scenario: `todos` group resolves to todo tool definitions
- **WHEN** a column defines `tools: [todos]`
- **THEN** `resolveToolsForColumn(["todos"])` returns a non-empty list containing the todo tools (`create_todo`, `edit_todo`, `list_todos`, `get_todo`, `reorganize_todos`, `update_todo_status`)

#### Scenario: All known group names expand without warnings
- **WHEN** `resolveToolsForColumn` is called with any group name defined in `TOOL_GROUPS`
- **THEN** the result is non-empty and no `[tools] Unknown tool` warning is logged

### Requirement: Tool names in column config are validated
The system SHALL log a warning at startup (or config load) when a column's `tools` array contains an unknown tool name. Unknown names SHALL be silently skipped so a typo does not break the column entirely.

#### Scenario: Unknown tool name is skipped with warning
- **WHEN** a column's `tools` list contains a name that does not match any registered tool or group
- **THEN** the system logs a warning identifying the unknown tool name and continues without it
