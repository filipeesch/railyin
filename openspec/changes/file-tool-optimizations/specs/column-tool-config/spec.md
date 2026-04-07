## MODIFIED Requirements

### Requirement: Workflow columns declare available tools

The system SHALL support an optional `tools` array in each workflow column definition. When present, only the named tools SHALL be offered to the model. When absent, the system SHALL fall back to the default tool set (`read_file`, `run_command`).

The `write` tool group SHALL expand to `["write_file", "edit_file"]`. The `read` tool group SHALL expand to `["read_file"]`. References to removed tools (`list_dir`, `delete_file`, `rename_file`, `patch_file`) SHALL be silently skipped with a warning.

#### Scenario: Column with tools list restricts model to named tools
- **WHEN** a column defines `tools: [read_file, ask_me]`
- **THEN** the AI request for that column includes only the `read_file` and `ask_me` tool definitions

#### Scenario: Column without tools key uses updated default set
- **WHEN** a column definition does not include a `tools` key
- **THEN** the AI request includes the default tool set (`read_file`, `run_command`) if a worktree is available

#### Scenario: References to removed tools are skipped
- **WHEN** a column defines `tools: [read, write, list_dir]`
- **THEN** `list_dir` is skipped with a warning and the column gets `read_file`, `write_file`, `edit_file`
