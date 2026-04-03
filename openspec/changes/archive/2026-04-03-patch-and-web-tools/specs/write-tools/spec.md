## ADDED Requirements

### Requirement: patch_file performs flexible in-place edits with multiple position modes
The system SHALL provide a `patch_file` tool that edits files in place. The tool SHALL accept a `position` parameter with values `"start"`, `"end"`, `"before"`, `"after"`, or `"replace"`. An `anchor` parameter SHALL be required when `position` is `"before"`, `"after"`, or `"replace"`. For anchor-based positions, the anchor string MUST appear exactly once in the file; the tool SHALL reject calls where the anchor appears zero or more than once times.

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

## REMOVED Requirements

### Requirement: replace_in_file makes surgical edits using old/new string matching
**Reason**: Superseded by `patch_file` with `position: "replace"`, which provides the same semantics plus four additional position modes. Removing reduces token cost from the system message.
**Migration**: Replace `replace_in_file({ path, old_string, new_string })` with `patch_file({ path, position: "replace", anchor: old_string, content: new_string })`.

## MODIFIED Requirements

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
