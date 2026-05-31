## MODIFIED Requirements

### Requirement: write_file creates or fully overwrites a file
The system SHALL provide a `write_file` tool that creates a new file or fully overwrites an existing one. The path MUST be confined to the worktree root (path traversal SHALL be rejected). When overwriting an existing file, the tool SHALL compute a line-level diff using the Myers algorithm and emit a `file_diff` message with `hunks` containing up to 3 context lines per changed region. When creating a new file, the tool SHALL emit a `file_diff` message with `is_new: true`, `added` equal to the line count of the new content, and `hunks` containing all lines as `added`. The string returned to the LLM SHALL include a compact change summary (e.g. `"OK: wrote src/foo.ts (+12 -4)"`).

The tool schema SHALL declare parameters in the order: `path`, `content`. The `content` field description SHALL include an explicit `REQUIRED` marker. The tool description SHALL include a required-params list and a concrete JSON example. The tool SHALL provide a `prepareArguments` hook that throws a targeted error if `content` is absent or not a string, before SDK AJV validation runs.

#### Scenario: Creates a new file
- **WHEN** an agent calls `write_file` with a path that does not exist and valid content
- **THEN** the file is created, the LLM receives `"OK: wrote <path> (+N lines)"`, and a `file_diff` message is emitted with `is_new: true`, `added: N`, `removed: 0`, and `hunks` with all lines as `added`

#### Scenario: Overwrites an existing file
- **WHEN** an agent calls `write_file` with a path that already exists
- **THEN** the file is fully replaced, the LLM receives `"OK: wrote <path> (+N -M)"`, and a `file_diff` message is emitted with `added: N`, `removed: M`, and `hunks` computed by Myers diff

#### Scenario: Path traversal is rejected
- **WHEN** an agent calls `write_file` with a path that resolves outside the worktree root (e.g. `../../etc/passwd`)
- **THEN** the tool returns an error string and no file is written

#### Scenario: Missing content returns targeted error before AJV
- **WHEN** an agent calls `write_file` with `path` provided but `content` absent or not a string
- **THEN** `prepareArguments` throws a targeted error message naming `"content"` specifically
- **THEN** the model receives the targeted error (not a generic AJV message)

### Requirement: patch_file performs flexible in-place edits with multiple position modes
The system SHALL provide a single `patch_file` tool with a `position` field. Each position mode SHALL apply `content` differently relative to the file or an `anchor` string. Position `"start"` and `"end"` need no anchor. Positions `"before"`, `"after"`, and `"replace"` require an `anchor` that appears exactly once in the file; the tool SHALL reject calls where the anchor appears zero or more than once times. On success, the tool SHALL emit a `file_diff` message. For `replace`, the anchor lines are `removed` and the content lines are `added`. For `before`/`after`, all content lines are `added` and `removed` is `0`. For `start`/`end`, all content lines are `added` and `removed` is `0`. The LLM return string SHALL include compact counts and, for anchor-based modes, the line number where the change was applied (e.g. `"OK: patched <path> (+2 -1 at line 47)"`). If the operation would result in no change to the file (e.g. empty content with `before`/`after`), the tool SHALL return an error rather than writing the unchanged file.

The tool schema SHALL declare parameters in the order: `path`, `content`, `anchor`, `position`. The `content` field description SHALL include an explicit `REQUIRED` marker. The `anchor` field description SHALL note it is ignored when `position` is `start` or `end`. The tool description SHALL include a required-params list and a concrete JSON example showing all four parameters. The tool SHALL provide a `prepareArguments` hook that throws a targeted error if `content` is absent or not a string, before SDK AJV validation runs.

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

#### Scenario: Missing content returns targeted error before AJV
- **WHEN** an agent calls `patch_file` with `path`, `anchor`, `position` provided but `content` absent or not a string
- **THEN** `prepareArguments` throws a targeted error message naming `"content"` specifically
- **THEN** the model receives the targeted error (not a generic AJV message)
