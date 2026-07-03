# cursor-rendering Specification

## Purpose
TBD - created by archiving change fix-cursor-rendering. Update Purpose after archive.
## Requirements
### Requirement: Tool call display metadata

The system SHALL emit `display` metadata on every `tool_start` and `tool_result` EngineEvent for Cursor's built-in tools and custom tools.

#### Scenario: Display metadata includes label and subject for read
- **WHEN** the SDK emits a `tool_call` with `name: "read"` and `args.path`
- **THEN** the `tool_start` EngineEvent includes `display.label: "read"` and `display.subject` set to the file path (stripped of worktree prefix)

#### Scenario: Display metadata includes label and subject for shell
- **WHEN** the SDK emits a `tool_call` with `name: "shell"` and `args.command`
- **THEN** the `tool_start` EngineEvent includes `display.label: "bash"` and `display.subject` set to the command string

#### Scenario: Display metadata includes label and subject for edit
- **WHEN** the SDK emits a `tool_call` with `name: "edit"` and `args.path`
- **THEN** the `tool_start` EngineEvent includes `display.label: "edit"` and `display.subject` set to the file path

#### Scenario: Display metadata for write
- **WHEN** the SDK emits a `tool_call` with `name: "write"` and `args.path`
- **THEN** the `tool_start` EngineEvent includes `display.label: "write"` and `display.subject` set to the file path

#### Scenario: Display metadata for delete
- **WHEN** the SDK emits a `tool_call` with `name: "delete"` and `args.path`
- **THEN** the `tool_start` EngineEvent includes `display.label: "delete"` and `display.subject` set to the file path

#### Scenario: Display metadata for glob
- **WHEN** the SDK emits a `tool_call` with `name: "glob"` and `args.pattern`
- **THEN** the `tool_start` EngineEvent includes `display.label: "glob"` and `display.subject` set to the pattern

#### Scenario: Display metadata for grep
- **WHEN** the SDK emits a `tool_call` with `name: "grep"` and `args.pattern` or `args.query`
- **THEN** the `tool_start` EngineEvent includes `display.label: "grep"` and `display.subject` set to the pattern

#### Scenario: Custom tools get humanized label
- **WHEN** the SDK emits a `tool_call` with a custom tool name (e.g., `"updateTodos"`, `"mcp"`)
- **THEN** the `tool_start` EngineEvent includes `display.label` set to the humanized tool name

### Requirement: Shell result structured extraction

The system SHALL extract `stdout` from shell tool results into the `detailedResult` field of `tool_result` EngineEvents, and append `stderr` when present.

#### Scenario: Shell success extracts stdout
- **WHEN** the SDK emits a `tool_call` with `name: "shell"`, `status: "completed"`, and `result.value.stdout`
- **THEN** the `tool_result` EngineEvent includes `detailedResult` set to the stdout content

#### Scenario: Shell success includes stderr
- **WHEN** the SDK emits a `tool_call` with `name: "shell"`, `status: "completed"`, and both `result.value.stdout` and `result.value.stderr`
- **THEN** the `tool_result` EngineEvent includes `detailedResult` with stdout followed by stderr

#### Scenario: Shell failure includes error output
- **WHEN** the SDK emits a `tool_call` with `name: "shell"`, `status: "error"`, and `result.value`
- **THEN** the `tool_result` EngineEvent includes `isError: true` and `detailedResult` with any available output

### Requirement: Edit/write diff extraction

The system SHALL parse `diffString` from edit and write tool results into `writtenFiles` with parsed hunks for file-diff rendering.

#### Scenario: Edit result parsed into writtenFiles
- **WHEN** the SDK emits a `tool_call` with `name: "edit"`, `status: "completed"`, and `result.value.diffString`
- **THEN** the `tool_result` EngineEvent includes `writtenFiles` with a `FileDiffPayload` containing the parsed path, operation `"edit_file"`, and `hunks` array

#### Scenario: Write result parsed into writtenFiles
- **WHEN** the SDK emits a `tool_call` with `name: "write"`, `status: "completed"`, and `result.value.diffString`
- **THEN** the `tool_result` EngineEvent includes `writtenFiles` with a `FileDiffPayload` containing `operation: "write_file"` and `hunks` array

#### Scenario: Diff parsing extracts added and removed lines
- **WHEN** a `diffString` contains `+` and `-` lines in hunk format
- **THEN** the parsed `hunks` array contains objects with `type: "added"` or `type: "removed"` entries

#### Scenario: Edit/write without diffString produces minimal writtenFiles
- **WHEN** the SDK emits a `tool_call` with `name: "edit"` or `name: "write"` and `status: "completed"` but no `diffString`
- **THEN** the `tool_result` EngineEvent includes `writtenFiles` with the path and operation, but without `hunks`

