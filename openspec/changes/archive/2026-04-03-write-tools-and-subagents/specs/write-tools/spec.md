## ADDED Requirements

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

### Requirement: replace_in_file makes surgical edits using old/new string matching
The system SHALL provide a `replace_in_file` tool that finds a unique occurrence of `old_string` in a file and replaces it with `new_string`. The tool SHALL reject the call if `old_string` appears zero times or more than once in the file.

#### Scenario: Successful surgical replacement
- **WHEN** an agent calls `replace_in_file` with an `old_string` that appears exactly once in the file
- **THEN** that occurrence is replaced with `new_string` and the modified content is written back

#### Scenario: Ambiguous match rejected
- **WHEN** an agent calls `replace_in_file` with an `old_string` that appears more than once in the file
- **THEN** the tool returns an error describing the ambiguity and no file is modified

#### Scenario: No match rejected
- **WHEN** an agent calls `replace_in_file` with an `old_string` that does not appear in the file
- **THEN** the tool returns an error and no file is modified

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
