## ADDED Requirements

### Requirement: fs-ops module exports wrapped filesystem functions
The system SHALL provide a local `fs-ops.ts` module at `src/bun/engine/pi/tools/fs-ops.ts` that wraps Node.js filesystem functions. This module SHALL export at minimum: `readFileSync`, `writeFileSync`, `existsSync`, `unlinkSync`, `renameSync`, `mkdirSync`, and `statSync`. Write tools SHALL import from this module instead of direct `node:fs` imports, enabling test-time mocking via `vi.mock()`.

#### Scenario: fs-ops re-exports readFileSync
- **WHEN** `fs-ops.ts` is imported and `readFileSync` is called
- **THEN** it delegates to `node:fs.readFileSync` with identical signature and return value

#### Scenario: fs-ops re-exports writeFileSync
- **WHEN** `fs-ops.ts` is imported and `writeFileSync` is called
- **THEN** it delegates to `node:fs.writeFileSync` with identical signature and no return value

#### Scenario: fs-ops re-exports all required functions
- **WHEN** `fs-ops.ts` is imported and destructured for `{ readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, mkdirSync, statSync }`
- **THEN** all seven names are available and delegate to their `node:fs` counterparts

### Requirement: Unit tests cover splitLines edge cases
The system SHALL have unit tests in `src/bun/test/write-tools-unit.test.ts` verifying the `splitLines()` line-counting algorithm matches spec semantics.

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

#### Scenario: Multiple trailing newlines stripped only once
- **WHEN** `splitLines("a\nb\n\n")` is called
- **THEN** it returns `3` (the empty line before trailing `\n` counts)

### Requirement: Unit tests verify computeFileDiff derived counts
The system SHALL have unit tests in `src/bun/test/write-tools-unit.test.ts` verifying that `computeFileDiff()` derives `added`/`removed` from hunk results, not raw input lengths.

#### Scenario: Single-line replacement in large file reports accurate counts
- **WHEN** `computeFileDiff()` compares a 150-line string where one line changed
- **THEN** `added` is `1` and `removed` is `1` (not `150`)

#### Scenario: No changes produces zero added and zero removed
- **WHEN** `computeFileDiff()` compares identical strings
- **THEN** `added` is `0` and `removed` is `0` and hunks is empty

#### Scenario: New file (empty before) reports correct added count
- **WHEN** `computeFileDiff("", "alpha\nbeta\ngamma\n", "new.ts", "write_file")` is called
- **THEN** `added` is `3`, `removed` is `0`, and hunks contain all three lines as type "added"

#### Scenario: File deletion (empty after) reports correct removed count
- **WHEN** `computeFileDiff("old content\n", "", "deleted.ts", "delete_file")` is called
- **THEN** `added` is `0`, `removed` is `1`, and hunks contain the line as type "removed"

#### Scenario: Multi-hunk diff sums counts across all hunks
- **WHEN** `computeFileDiff()` finds two non-adjacent changes producing two hunks
- **THEN** `added` equals total added lines across all hunks combined

### Requirement: Integration tests execute full tool paths with real filesystem
The system SHALL have integration tests in `src/bun/test/write-tools-integration.test.ts` executing actual write tool functions against tmpdir directories. Each test group uses fresh `mkdtempSync()` and cleans up in `afterEach`. Tests verify both filesystem mutations and returned `writtenFiles` payloads.

#### Scenario: write_file creates new file with correct payload
- **WHEN** `write_file({ path: "new.txt", content: "hello" })` is called on a non-existent path in a tmpdir
- **THEN** the file exists on disk with content `"hello"`
- **AND** the returned payload has `operation: "write_file"`, `is_new: true`, and correct `added`/`removed` counts

#### Scenario: write_file overwrites existing file with correct diff
- **WHEN** `write_file` is called on an existing 50-line file changing one line
- **THEN** the file content reflects the new version
- **AND** the returned payload has `added: 1`, `removed: 1` matching actual changes

#### Scenario: patch_file replace position substitutes anchor with correct counts
- **WHEN** `patch_file({ position: "replace", anchor: "old_line", content: "new_line" })` is called
- **THEN** the file content has anchor replaced with content
- **AND** the returned payload has `operation: "patch_file"` with accurate `added`/`removed` derived from hunks

#### Scenario: patch_file before/after positions insert without removing
- **WHEN** `patch_file({ position: "before", anchor: "target", content: "inserted" })` is called
- **THEN** content appears before the anchor in the file
- **AND** the returned payload has `removed: 0` and `added` equal to content line count

#### Scenario: patch_file rejects duplicate anchor
- **WHEN** `patch_file` is called with an anchor appearing twice in the file
- **THEN** result has `isError: true` and descriptive error message
- **AND** the file content is unchanged

#### Scenario: delete_file removes file and emits diff payload
- **WHEN** `delete_file({ path: "to-delete.txt" })` is called on an existing file
- **THEN** the file no longer exists on disk
- **AND** the returned payload has `operation: "delete_file"`, `added: 0`, `removed` equal to deleted file's line count, and hunks with all lines as type "removed"

#### Scenario: rename_file moves file and emits payload with both paths
- **WHEN** `rename_file({ from: "a.txt", to: "b.txt" })` is called
- **THEN** original path no longer exists, destination path contains original content
- **AND** the returned payload has `operation: "rename_file"`, `path` as source, `to_path` as destination, `added: 0`, `removed: 0`

### Requirement: E2E regression test verifies UI renders writtenFiles correctly
The system SHALL have a Playwright regression test in `e2e/ui/stream-reactivity.spec.ts` that mocks a `tool_result` event containing known `writtenFiles` data and asserts the UI displays correct `(+N -M)` line change indicators.

#### Scenario: UI shows correct added/removed counts from mock writtenFiles
- **WHEN** the mocked API returns a `tool_result` event with `writtenFiles: [{ operation: "patch_file", path: "test.ts", added: 3, removed: 1, hunks: [...] }]`
- **THEN** the UI component renders a file_diff block showing `"3 additions, 1 deletion"` or equivalent `(+" + 3 "- 1")` format

#### Scenario: UI handles multiple files in single tool result
- **WHEN** the mocked API returns `writtenFiles` array with two entries
- **THEN** the UI renders two separate file_diff blocks, each with its own correct counts
