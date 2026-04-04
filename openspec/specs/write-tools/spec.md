## Purpose
Write tools allow AI agents to create, modify, delete, and rename files within a task's git worktree. All operations are path-safe and confined to the worktree root.

## Requirements

### Requirement: write_file creates or fully overwrites a file
The system SHALL provide a `write_file` tool that creates a new file or fully overwrites an existing one. The path MUST be confined to the worktree root (path traversal SHALL be rejected). When overwriting an existing file, the tool SHALL compute a line-level diff using the Myers algorithm and emit a `file_diff` message with `hunks` containing up to 3 context lines per changed region. When creating a new file, the tool SHALL emit a `file_diff` message with `is_new: true`, `added` equal to the line count of the new content, and `hunks` containing all lines as `added`. The string returned to the LLM SHALL include a compact change summary (e.g. `"OK: wrote src/foo.ts (+12 -4)"`).

#### Scenario: Creates a new file
- **WHEN** an agent calls `write_file` with a path that does not exist and valid content
- **THEN** the file is created, the LLM receives `"OK: wrote <path> (+N lines)"`, and a `file_diff` message is emitted with `is_new: true`, `added: N`, `removed: 0`, and `hunks` with all lines as `added`

#### Scenario: Overwrites an existing file
- **WHEN** an agent calls `write_file` with a path that already exists
- **THEN** the file is fully replaced, the LLM receives `"OK: wrote <path> (+N -M)"`, and a `file_diff` message is emitted with `added: N`, `removed: M`, and `hunks` computed by Myers diff

#### Scenario: Path traversal is rejected
- **WHEN** an agent calls `write_file` with a path that resolves outside the worktree root (e.g. `../../etc/passwd`)
- **THEN** the tool returns an error string and no file is written

### Requirement: patch_file performs flexible in-place edits with multiple position modes
The system SHALL provide a single `patch_file` tool with a `position` field. Each position mode SHALL apply `content` differently relative to the file or an `anchor` string. Position `"start"` and `"end"` need no anchor. Positions `"before"`, `"after"`, and `"replace"` require an `anchor` that appears exactly once in the file; the tool SHALL reject calls where the anchor appears zero or more than once times. On success, the tool SHALL emit a `file_diff` message. For `replace`, the anchor lines are `removed` and the content lines are `added`. For `before`/`after`, all content lines are `added` and `removed` is `0`. For `start`/`end`, all content lines are `added` and `removed` is `0`. The LLM return string SHALL include compact counts and, for anchor-based modes, the line number where the change was applied (e.g. `"OK: patched <path> (+2 -1 at line 47)"`). If the operation would result in no change to the file (e.g. empty content with `before`/`after`), the tool SHALL return an error rather than writing the unchanged file.

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

#### Scenario: No-op patch is rejected
- **WHEN** an agent calls `patch_file` with an operation that would not change the file content (e.g. empty `content` with `position: "before"`)
- **THEN** the tool returns a descriptive error and no file is modified

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
The system SHALL provide a `delete_file` tool that deletes a file by path within the worktree. The path MUST be confined to the worktree root (path traversal SHALL be rejected). The tool SHALL be included in the `"write"` tool group. On success, the tool SHALL emit a `file_diff` message with `operation: "delete_file"`, `removed` equal to the line count of the deleted file, and `hunks` containing all lines as `removed`.

#### Scenario: File is deleted
- **WHEN** an agent calls `delete_file` with a path to an existing file
- **THEN** the file is removed from the worktree, and a `file_diff` message is emitted with `operation: "delete_file"`, `removed` equal to the line count, `added: 0`, and `hunks` with all lines as `removed`

#### Scenario: Non-existent file returns error
- **WHEN** an agent calls `delete_file` with a path that does not exist
- **THEN** the tool returns an error string and no filesystem change occurs

#### Scenario: Path traversal is rejected
- **WHEN** an agent calls `delete_file` with a path that resolves outside the worktree root
- **THEN** the tool returns an error and no file is deleted

### Requirement: rename_file moves or renames a file within the worktree
The system SHALL provide a `rename_file` tool that renames or moves a file. Both source and destination paths MUST be confined to the worktree root. On success the tool SHALL emit a `file_diff` message with `operation: "rename_file"`, `path` as the source, `to_path` as the destination, `added: 0`, and `removed: 0`.

#### Scenario: File is renamed
- **WHEN** an agent calls `rename_file` with an existing source path and a new destination path
- **THEN** the file is moved/renamed, the original path no longer exists, and a `file_diff` message is emitted with `path` and `to_path`

#### Scenario: Destination outside worktree is rejected
- **WHEN** an agent calls `rename_file` with a destination path outside the worktree root
- **THEN** the tool returns an error and no file is moved

### Requirement: Write tools return a structured diff payload on success
The system SHALL return a `WriteResult` object `{ content: string; diff: FileDiffPayload }` from every successful write tool call (`write_file`, `patch_file`, `delete_file`, `rename_file`), where `content` is the LLM-facing confirmation string and `diff` is a structured `FileDiffPayload`. Error paths SHALL still return a plain string.

A `FileDiffPayload` SHALL contain:
- `operation` — the tool name that produced it
- `path` — the relative file path
- `added` — number of lines added (integer ≥ 0)
- `removed` — number of lines removed (integer ≥ 0)
- `hunks` — optional array of `Hunk` objects for anchor-based `patch_file` edits

#### Scenario: Successful write_file returns WriteResult
- **WHEN** `write_file` succeeds
- **THEN** the return value is `{ content: "OK: …", diff: FileDiffPayload }` with `operation: "write_file"`

#### Scenario: Successful patch_file returns WriteResult
- **WHEN** `patch_file` succeeds
- **THEN** the return value is `{ content: "OK: …", diff: FileDiffPayload }` with `operation: "patch_file"` and `added`/`removed` counts matching what was applied

#### Scenario: Error path returns plain string
- **WHEN** any write tool fails (path traversal, anchor not found, etc.)
- **THEN** the return value is a plain error string, not a `WriteResult`

### Requirement: Line counting treats empty content as zero lines and strips trailing newlines
The system SHALL use a consistent line-counting algorithm (`splitLines`) for all write tool diff payloads:
- An empty string (`""`) produces **0 lines**
- A string containing only `"\n"` produces **1 line** (one blank line)
- A newline-terminated string (e.g. `"a\nb\n"`) produces the same count as its non-terminated equivalent (`"a\nb"`) — trailing newlines do not add an extra line

This count SHALL be reflected identically in both the `FileDiffPayload.added`/`removed` fields and in the LLM-facing `content` confirmation string.

#### Scenario: Empty content insertion reports 0 added
- **WHEN** `patch_file` is called with `content: ""`
- **THEN** `diff.added` is `0` and the confirmation string does not claim any lines were added

#### Scenario: Single blank line reports 1 added
- **WHEN** `patch_file` is called with `content: "\n"`
- **THEN** `diff.added` is `1`

### Requirement: The engine stores each write tool result as a file_diff conversation message
The system SHALL append a `file_diff`-type `ConversationMessage` after every successful write tool call, containing the JSON-serialised `FileDiffPayload` as its content. `file_diff` messages SHALL be excluded from the LLM message context (they are UI-only).

#### Scenario: file_diff message appended after write tool
- **WHEN** a write tool succeeds
- **THEN** a `file_diff` message with the serialised payload is persisted to the conversation immediately after the `tool_result` message

#### Scenario: file_diff excluded from LLM context
- **WHEN** the engine compacts messages for an LLM call
- **THEN** no `file_diff` messages are included in the message array sent to the model
