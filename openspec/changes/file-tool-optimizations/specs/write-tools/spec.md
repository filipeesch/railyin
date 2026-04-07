## REMOVED Requirements

### Requirement: list_dir tool
**Reason**: Redundant with `find_files` (glob patterns) and `run_command ls`. Saves ~130 tokens of tool definition per API call.
**Migration**: Use `find_files` with patterns like `src/*` or `run_command` with `ls -la src/`.

### Requirement: delete_file tool
**Reason**: Redundant with `run_command rm`. Saves ~100 tokens of tool definition per API call.
**Migration**: Use `run_command` with `rm path/to/file`.

### Requirement: rename_file tool
**Reason**: Redundant with `run_command mv`. Saves ~120 tokens of tool definition per API call.
**Migration**: Use `run_command` with `mv from_path to_path`.

## MODIFIED Requirements

### Requirement: Write tools available in the system

The system SHALL provide the following write tools: `write_file`, `edit_file`. The tools `patch_file`, `list_dir`, `delete_file`, and `rename_file` are removed.

#### Scenario: Available write tools
- **WHEN** a column includes the `write` tool group
- **THEN** the tools `write_file` and `edit_file` are offered to the model

#### Scenario: Removed tools not available
- **WHEN** a column references `patch_file`, `list_dir`, `delete_file`, or `rename_file`
- **THEN** the system logs a warning and skips the unknown tool name
