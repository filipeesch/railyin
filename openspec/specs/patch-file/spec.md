## Purpose
The `patch_file` tool provides a unified in-place file editing primitive for AI agents, replacing the narrower `replace_in_file` tool with four position modes and full path safety.

## Requirements

### Requirement: patch_file supports start, end, before, after, and replace positions
The system SHALL provide a single `patch_file` tool with a `position` field. Each position mode SHALL apply `content` differently relative to the file or an `anchor` string. Position `"start"` and `"end"` need no anchor. Positions `"before"`, `"after"`, and `"replace"` require an `anchor` that appears exactly once in the file.

#### Scenario: position=start prepends content
- **WHEN** `position` is `"start"` and no anchor is given
- **THEN** `content` is inserted before the first character of the file

#### Scenario: position=end appends content
- **WHEN** `position` is `"end"` and no anchor is given
- **THEN** `content` is appended after the last character of the file

#### Scenario: position=before inserts above anchor
- **WHEN** `position` is `"before"` and anchor appears exactly once
- **THEN** `content` is inserted immediately before the anchor string

#### Scenario: position=after inserts below anchor
- **WHEN** `position` is `"after"` and anchor appears exactly once
- **THEN** `content` is inserted immediately after the anchor string

#### Scenario: position=replace substitutes anchor
- **WHEN** `position` is `"replace"` and anchor appears exactly once
- **THEN** the anchor string is replaced by `content`

#### Scenario: Ambiguous anchor causes rejection
- **WHEN** anchor appears more than once in the file
- **THEN** tool returns an error instructing the agent to add more context

#### Scenario: Anchor not found causes rejection
- **WHEN** anchor does not appear in the file
- **THEN** tool returns an error indicating the anchor was not found

#### Scenario: Path outside worktree is rejected
- **WHEN** the path resolves outside the worktree root
- **THEN** tool returns a path traversal error and writes nothing

### Requirement: patch_file returns accurate line counts using consistent line-splitting semantics
The tool SHALL compute `added` and `removed` line counts using the same algorithm as `write_file` and other write tools: an empty string contributes 0 lines; a trailing newline does not add an extra line; a string consisting solely of `"\n"` contributes 1 line. The count in the LLM confirmation string SHALL match the `FileDiffPayload.added`/`removed` values exactly.

#### Scenario: Empty content has 0 added lines
- **WHEN** `patch_file` is called with `content: ""`
- **THEN** `diff.added` is `0` and the confirmation string reports no lines added

#### Scenario: Single newline has 1 added line
- **WHEN** `patch_file` is called with `content: "\n"`
- **THEN** `diff.added` is `1`

#### Scenario: Newline-terminated content does not over-count
- **WHEN** `patch_file` is called with `content: "line1\nline2\n"`
- **THEN** `diff.added` is `2`, not `3`
