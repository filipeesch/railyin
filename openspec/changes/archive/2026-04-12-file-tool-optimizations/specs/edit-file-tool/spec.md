## ADDED Requirements

### Requirement: edit_file tool performs old_string/new_string replacement

The system SHALL provide an `edit_file` tool that accepts `path` (relative to worktree), `old_string` (text to find), `new_string` (replacement text), and optional `replace_all` (boolean). The tool SHALL find `old_string` in the file and replace it with `new_string`. When `replace_all` is true, all occurrences SHALL be replaced.

#### Scenario: Single replacement succeeds
- **WHEN** `edit_file` is called with `old_string` that appears exactly once in the file
- **THEN** the occurrence is replaced with `new_string` and the tool returns `"The file {path} has been updated successfully."`

#### Scenario: Multiple matches without replace_all fails
- **WHEN** `edit_file` is called with `old_string` that appears multiple times and `replace_all` is not set
- **THEN** the tool returns an error indicating the string matches multiple locations, advising to use more context or `replace_all`

#### Scenario: replace_all replaces all occurrences
- **WHEN** `edit_file` is called with `replace_all: true`
- **THEN** all occurrences of `old_string` are replaced with `new_string` and the tool returns a success message indicating all occurrences were replaced

#### Scenario: old_string not found returns error
- **WHEN** `edit_file` is called with `old_string` that does not exist in the file
- **THEN** the tool returns an error indicating the string was not found

#### Scenario: File creation via empty old_string
- **WHEN** `edit_file` is called with `old_string: ""` on a file that does not exist
- **THEN** the file is created with `new_string` as its content and the tool returns `"File created successfully at: {path}"`

### Requirement: edit_file enforces read-before-write

The system SHALL track which files have been read (via `read_file`) during the current execution by recording file path and `mtimeMs` at read time. The `edit_file` tool SHALL reject edits to files that have not been read in the current execution, returning an error message instructing the model to read the file first.

#### Scenario: Edit rejected for unread file
- **WHEN** `edit_file` is called for a file that has not been read via `read_file` in this execution
- **THEN** the tool returns `"Error: You must read the file before editing it. Use read_file first."`

#### Scenario: Edit allowed after read
- **WHEN** `read_file` has been called for the file, then `edit_file` is called
- **THEN** the edit proceeds normally

### Requirement: edit_file returns WriteResult with diff

The `edit_file` tool SHALL return a `WriteResult` object with a terse `content` string for the LLM and a `diff: FileDiffPayload` with Myers diff hunks for the UI. The LLM SHALL only see the short confirmation string, not the diff.

#### Scenario: Successful edit returns diff for UI
- **WHEN** `edit_file` replaces text successfully
- **THEN** the return value includes `{ content: "The file X has been updated successfully.", diff: { operation, path, added, removed, hunks } }`
