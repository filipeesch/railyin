## Purpose
Write tool tests provide comprehensive test coverage for Pi engine write tools (`write_file`, `patch_file`, `delete_file`, `rename_file`) across unit, integration, and E2E layers. This ensures diff computation, file mutation, and payload generation bugs are caught before production.

## Requirements

### Requirement: Unit tests cover splitLines edge cases
The system SHALL have unit tests verifying the `splitLines()` line-counting algorithm matches spec semantics. Tests verify empty string, single newline, trailing-newline-stripped, no-trailing-newline, and multiple-trailing-newlines scenarios.

#### Scenario: Empty string produces 0 lines
- **WHEN** `splitLines("")` is called
- **THEN** it returns `0`

#### Scenario: Single newline produces 1 line
- **WHEN** `splitLines("\n")` is called
- **THEN** it returns `1`

#### Scenario: Trailing newline does not add extra line
- **WHEN** `splitLines("a\nb\nc\n")` is called
- **THEN** it returns `3` (same as `"a\nb\nc"`)

#### Scenario: No trailing newline counts all lines
- **WHEN** `splitLines("line1\nline2")` is called
- **THEN** it returns `2`

### Requirement: Unit tests verify computeFileDiff derived counts
The system SHALL have unit tests verifying that `computeFileDiff()` derives `added`/`removed` from hunk results, not raw input lengths. Tests cover single-line replacement, identical strings, new file creation, file deletion, and multi-hunk diffs.

#### Scenario: Single-line replacement in large file reports accurate counts
- **WHEN** comparing a 150-line string where one line changed
- **THEN** `added` is `1` and `removed` is `1` (not `150`)

#### Scenario: No changes produces zero added and zero removed
- **WHEN** comparing identical strings
- **THEN** `added` is `0` and `removed` is `0` and hunks is empty

#### Scenario: New file (empty before) reports correct added count
- **WHEN** computing diff between empty string and 3-line content
- **THEN** `added` is `3`, `removed` is `0`, and hunks contain all three lines as type "added"

### Requirement: Integration tests execute full tool paths with real filesystem
The system SHALL have integration tests executing actual write tool functions against tmpdir directories. Each test group uses fresh `mkdtempSync()` and cleans up in `afterEach`. Tests verify both filesystem mutations and returned `writtenFiles` payloads.

#### Scenario: write_file creates new file with correct payload
- **WHEN** `write_file({ path: "new.txt", content: "hello" })` is called on a non-existent path
- **THEN** the file exists on disk with correct content and payload has `is_new: true`

#### Scenario: patch_file rejects duplicate anchor
- **WHEN** `patch_file` is called with an anchor appearing twice in the file
- **THEN** result has `isError: true` and file content is unchanged

#### Scenario: delete_file removes file and emits diff payload
- **WHEN** `delete_file({ path: "to-delete.txt" })` is called on an existing file
- **THEN** the file no longer exists and payload has `operation: "delete_file"` with correct `removed` count

### Requirement: E2E regression test verifies UI renders writtenFiles correctly
The system SHALL have a Playwright regression test that mocks a `tool_result` event containing known `writtenFiles` data and asserts the UI displays correct `(+N -M)` line change indicators in file_diff blocks.

#### Scenario: UI shows correct added/removed counts from mock writtenFiles
- **WHEN** mocked API returns `tool_result` with `writtenFiles: [{ operation: "patch_file", path: "test.ts", added: 3, removed: 1 }]`
- **THEN** the UI renders stat badges showing +3 additions and -1 deletion
