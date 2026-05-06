## MODIFIED Requirements

### Requirement: Workflow columns declare available tools

The system SHALL support an optional `tools` array in each workflow column definition. When present, only the named tools SHALL be offered to the model. When absent, the system SHALL fall back to the default tool set (`read_file`, `list_dir`, `run_command`). Group names (e.g., `todos`, `web`, `write`, `read`, `search`, `shell`, `board`, `interactions`) SHALL expand to their constituent tool definitions per the active engine's `TOOL_GROUPS` map. Every group name in `TOOL_GROUPS` SHALL resolve to at least one tool definition — groups with no registered definitions are a configuration error.

The Pi engine SHALL register a `PI_TOOL_GROUPS` map that expands the following group names: `read` (`read_file`, `list_dir`), `write` (`write_file`, `patch_file`, `delete_file`, `rename_file`, `undo_write`), `search` (`search_text`, `find_files`), `shell` (`run_command`), `web` (`fetch_url`, `search_internet`), `board` (task/board management tools from common-tools), `interactions` (`ask_user` and related). `board` and `interactions` groups SHALL always be injected regardless of column tool config.

#### Scenario: Column with tools list restricts model to named tools

- **WHEN** a column defines `tools: [read_file, ask_user]`
- **THEN** the AI request for that column includes only the `read_file` and `ask_user` tool definitions

#### Scenario: Column without tools key uses default set

- **WHEN** a column definition does not include a `tools` key
- **THEN** the AI request includes the default tool set (`read_file`, `list_dir`, `run_command`) if a worktree is available

#### Scenario: Pi engine column configured with named groups gets expanded tools
- **WHEN** a column for a Pi engine execution defines `tools: ["read", "search"]`
- **THEN** the Pi execution receives `read_file`, `list_dir`, `search_text`, `find_files` plus board and interaction tools
