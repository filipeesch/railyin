## ADDED Requirements

### Requirement: delete_file removes a file from the worktree
The system SHALL provide a `delete_file` tool that deletes a file by path within the worktree. The path MUST be confined to the worktree root (path traversal SHALL be rejected). The tool SHALL be included in the `"write"` tool group.

#### Scenario: File is deleted
- **WHEN** an agent calls `delete_file` with a path to an existing file
- **THEN** the file is removed from the worktree, and a `file_diff` message is emitted with `operation: "delete_file"`, `removed` equal to the line count of the deleted file, and no `hunks` field

#### Scenario: Non-existent file returns error
- **WHEN** an agent calls `delete_file` with a path that does not exist
- **THEN** the tool returns an error string and no filesystem change occurs

#### Scenario: Path traversal is rejected
- **WHEN** an agent calls `delete_file` with a path that resolves outside the worktree root
- **THEN** the tool returns an error and no file is deleted

## MODIFIED Requirements

### Requirement: write_file creates or fully overwrites a file
The system SHALL provide a `write_file` tool that creates a new file or fully overwrites an existing one. The path MUST be confined to the worktree root (path traversal SHALL be rejected). When overwriting an existing file, the tool SHALL compute a line-level diff using the Myers algorithm and emit a `file_diff` message with `hunks` containing up to 3 context lines per changed region. When creating a new file, the tool SHALL emit a `file_diff` message with `is_new: true` and `added` equal to the line count of the new content. The string returned to the LLM SHALL include a compact change summary (e.g. `"OK: wrote src/foo.ts (+12 -4)"`).

#### Scenario: Creates a new file
- **WHEN** an agent calls `write_file` with a path that does not exist and valid content
- **THEN** the file is created, the LLM receives `"OK: wrote <path> (+N lines)"`, and a `file_diff` message is emitted with `is_new: true`, `added: N`, `removed: 0`, and no `hunks`

#### Scenario: Overwrites an existing file
- **WHEN** an agent calls `write_file` with a path that already exists
- **THEN** the file is fully replaced, the LLM receives `"OK: wrote <path> (+N -M)"`, and a `file_diff` message is emitted with `added: N`, `removed: M`, and `hunks` computed by Myers diff

#### Scenario: Path traversal is rejected
- **WHEN** an agent calls `write_file` with a path that resolves outside the worktree root
- **THEN** the tool returns an error string and no file is written

### Requirement: patch_file performs flexible in-place edits with multiple position modes
The system SHALL provide a single `patch_file` tool with a `position` field. Each position mode SHALL apply `content` differently relative to the file or an `anchor` string. Position `"start"` and `"end"` need no anchor. Positions `"before"`, `"after"`, and `"replace"` require an `anchor` that appears exactly once in the file; the tool SHALL reject calls where the anchor appears zero or more than once times. On success, the tool SHALL emit a `file_diff` message. For `replace`, the anchor lines are `removed` and the content lines are `added`. For `before`/`after`, all content lines are `added` and `removed` is `0`. For `start`/`end`, all content lines are `added` and `removed` is `0`. The LLM return string SHALL include compact counts and, for anchor-based modes, the line number where the change was applied (e.g. `"OK: patched <path> (+2 -1 at line 47)"`).

#### Scenario: Prepend content to file (position=start)
- **WHEN** an agent calls `patch_file` with `position: "start"` and `content`
- **THEN** the content is inserted at the beginning of the file and a `file_diff` message is emitted with `added` equal to the line count of content and `removed: 0`

#### Scenario: Append content to file (position=end)
- **WHEN** an agent calls `patch_file` with `position: "end"` and `content`
- **THEN** the content is appended at the end of the file and a `file_diff` message is emitted with `added` equal to the line count of content and `removed: 0`

#### Scenario: Insert before anchor (position=before)
- **WHEN** an agent calls `patch_file` with `position: "before"`, a unique `anchor`, and `content`
- **THEN** the content is inserted immediately before the anchor string and a `file_diff` message is emitted with the anchor's line number, `added` equal to content line count, and `removed: 0`

#### Scenario: Insert after anchor (position=after)
- **WHEN** an agent calls `patch_file` with `position: "after"`, a unique `anchor`, and `content`
- **THEN** the content is inserted immediately after the anchor string and a `file_diff` message is emitted with the anchor's line number, `added` equal to content line count, and `removed: 0`

#### Scenario: Replace anchor with content (position=replace)
- **WHEN** an agent calls `patch_file` with `position: "replace"`, a unique `anchor`, and `content`
- **THEN** the anchor string is replaced with the content and a `file_diff` message is emitted with `removed` equal to the anchor's line count and `added` equal to the content line count

#### Scenario: Ambiguous anchor rejected
- **WHEN** an agent calls `patch_file` with an `anchor` that appears more than once in the file
- **THEN** the tool returns an error describing the ambiguity and no file is modified

#### Scenario: Missing anchor rejected
- **WHEN** an agent calls `patch_file` with `position: "replace"` and an `anchor` not found in the file
- **THEN** the tool returns an error and no file is modified

#### Scenario: Path traversal is rejected
- **WHEN** an agent calls `patch_file` with a path that resolves outside the worktree root
- **THEN** the tool returns an error and no file is modified

### Requirement: rename_file moves or renames a file within the worktree
The system SHALL provide a `rename_file` tool that renames or moves a file. Both source and destination paths MUST be confined to the worktree root. On success the tool SHALL emit a `file_diff` message with `operation: "rename_file"`, `path` as the source, `to_path` as the destination, `added: 0`, and `removed: 0`.

#### Scenario: File is renamed
- **WHEN** an agent calls `rename_file` with an existing source path and a new destination path
- **THEN** the file is moved/renamed, the original path no longer exists, and a `file_diff` message is emitted with `from_path` and `to_path`

#### Scenario: Destination outside worktree is rejected
- **WHEN** an agent calls `rename_file` with a destination path outside the worktree root
- **THEN** the tool returns an error and no file is moved
