## Purpose
Write tools allow AI agents to create, modify, delete, and rename files within a task's git worktree. All operations are path-safe and confined to the worktree root.

## Requirements

### Requirement: write_file creates or fully overwrites a file
The system SHALL provide a `write_file` tool that creates a new file or fully overwrites an existing one. The path MUST be confined to the worktree root (path traversal SHALL be rejected).

#### Scenario: Creates a new file
- **WHEN** an agent calls `write_file` with a path that does not exist and valid content
- **THEN** the file is created at that path within the worktree with the specified content

#### Scenario: Overwrites an existing file
- **WHEN** an agent calls `write_file` with a path that already exists
- **THEN** the file is fully replaced with the new content

#### Scenario: Path traversal is rejected
- **WHEN** an agent calls `write_file` with a path that resolves outside the worktree root (e.g. `../../etc/passwd`)
- **THEN** the tool returns an error string and no file is written

### Requirement: patch_file performs flexible in-place edits with multiple position modes
The system SHALL provide a single `patch_file` tool with a `position` field. Each position mode SHALL apply `content` differently relative to the file or an `anchor` string. Position `"start"` and `"end"` need no anchor. Positions `"before"`, `"after"`, and `"replace"` require an `anchor` that appears exactly once in the file; the tool SHALL reject calls where the anchor appears zero or more than once times.

#### Scenario: Prepend content to file (position=start)
- **WHEN** an agent calls `patch_file` with `position: "start"` and `content`
- **THEN** the content is inserted at the beginning of the file

#### Scenario: Append content to file (position=end)
- **WHEN** an agent calls `patch_file` with `position: "end"` and `content`
- **THEN** the content is appended at the end of the file

#### Scenario: Insert before anchor (position=before)
- **WHEN** an agent calls `patch_file` with `position: "before"`, a unique `anchor`, and `content`
- **THEN** the content is inserted immediately before the anchor string

#### Scenario: Insert after anchor (position=after)
- **WHEN** an agent calls `patch_file` with `position: "after"`, a unique `anchor`, and `content`
- **THEN** the content is inserted immediately after the anchor string

#### Scenario: Replace anchor with content (position=replace)
- **WHEN** an agent calls `patch_file` with `position: "replace"`, a unique `anchor`, and `content`
- **THEN** the anchor string is replaced with the content (equivalent to former replace_in_file)

#### Scenario: Ambiguous anchor rejected
- **WHEN** an agent calls `patch_file` with an `anchor` that appears more than once in the file
- **THEN** the tool returns an error describing the ambiguity and no file is modified

#### Scenario: Missing anchor rejected
- **WHEN** an agent calls `patch_file` with `position: "replace"` and an `anchor` not found in the file
- **THEN** the tool returns an error and no file is modified

#### Scenario: Path traversal is rejected
- **WHEN** an agent calls `patch_file` with a path that resolves outside the worktree root
- **THEN** the tool returns an error and no file is modified

### Requirement: read_file reads file contents with optional line range
The system SHALL provide a `read_file` tool that returns the contents of a file within the worktree. The tool SHALL accept optional `start_line` and `end_line` integer parameters (1-based). When provided, only lines within the range SHALL be returned. When omitted, the full file is returned. The path MUST be confined to the worktree root.

#### Scenario: Full file read (no range specified)
- **WHEN** an agent calls `read_file` with only a `path`
- **THEN** the full file contents are returned

#### Scenario: Partial read with start and end line
- **WHEN** an agent calls `read_file` with `start_line` and `end_line`
- **THEN** only lines within that range (inclusive) are returned

#### Scenario: Partial read with only start_line
- **WHEN** an agent calls `read_file` with only `start_line`
- **THEN** lines from `start_line` to end of file are returned

#### Scenario: Path traversal is rejected
- **WHEN** an agent calls `read_file` with a path that resolves outside the worktree root
- **THEN** the tool returns an error and no content is returned

### Requirement: delete_file removes a file from the worktree
The system SHALL provide a `delete_file` tool that deletes a file by path. The path MUST be confined to the worktree root.

#### Scenario: File is deleted
- **WHEN** an agent calls `delete_file` with a path to an existing file
- **THEN** the file is removed from the worktree

#### Scenario: Non-existent file returns error
- **WHEN** an agent calls `delete_file` with a path that does not exist
- **THEN** the tool returns an error string and no filesystem change occurs

### Requirement: rename_file moves or renames a file within the worktree
The system SHALL provide a `rename_file` tool that renames or moves a file. Both source and destination paths MUST be confined to the worktree root.

#### Scenario: File is renamed
- **WHEN** an agent calls `rename_file` with an existing source path and a new destination path
- **THEN** the file is moved/renamed and the original path no longer exists

#### Scenario: Destination outside worktree is rejected
- **WHEN** an agent calls `rename_file` with a destination path outside the worktree root
- **THEN** the tool returns an error and no file is moved
