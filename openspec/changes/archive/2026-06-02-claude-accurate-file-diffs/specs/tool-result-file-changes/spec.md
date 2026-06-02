## MODIFIED Requirements

### Requirement: WrittenFile entries align with shared diff semantics
Each `WrittenFile` in `writtenFiles` SHALL follow the shared diff semantics used by the UI, including `path`, `operation`, `added`, `removed`, and optional `hunks`, `to_path`, and `is_new` fields. The Claude engine SHALL always provide hunk-level detail for `write`, `edit`, and `multiedit` tool results by computing diffs from captured before-content and post-execution disk state. Falling back to a shallow payload (no `hunks`) is only permitted when before-content capture fails.

#### Scenario: Claude write produces hunk-level diff
- **WHEN** the Claude engine processes a `write` tool result for an existing file
- **THEN** the `WrittenFile` entry includes `hunks` reflecting only the lines changed by that specific tool call

#### Scenario: Claude edit produces hunk-level diff
- **WHEN** the Claude engine processes an `edit` tool result
- **THEN** the `WrittenFile` entry includes `hunks` reflecting only the lines changed by that specific tool call

#### Scenario: Claude multiedit produces hunk-level diff
- **WHEN** the Claude engine processes a `multiedit` tool result with multiple edits applied to one file
- **THEN** the `WrittenFile` entry includes `hunks` reflecting the combined effect of all edits in that call

#### Scenario: Multiple writes to the same file in one execution
- **WHEN** a Claude execution calls `write` or `edit` on the same file twice sequentially
- **THEN** each tool result contains a diff scoped only to its own change (not an accumulation from HEAD)

#### Scenario: Write creates a new file
- **WHEN** the Claude engine processes a `write` tool result for a file that did not previously exist
- **THEN** the `WrittenFile` entry has `is_new: true` and `hunks` showing all lines as added

#### Scenario: Hunk-capable tools provide hunk detail
- **WHEN** an engine can determine hunk-level edits for a changed file
- **THEN** the `WrittenFile` entry includes `hunks` with line-level added/removed/context information

#### Scenario: Partial detail is still valid
- **WHEN** an engine can determine changed paths but cannot extract reliable hunks (e.g. before-content capture failed)
- **THEN** it still emits `WrittenFile` entries with available fields and omits unavailable optional fields
