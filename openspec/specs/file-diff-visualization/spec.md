## Purpose
File diff visualization allows the UI to display structured change information from write tool calls. When an agent creates, modifies, deletes, or renames a file, the resulting `file_diff` message is rendered inline inside the tool call group as a unified diff view.

## Requirements

### Requirement: file_diff is a first-class message type
The system SHALL define `"file_diff"` as a valid `MessageType` in `rpc-types.ts`. The `FileDiffPayload` type SHALL be exported for use by both backend and frontend.

#### Scenario: file_diff type is accepted in conversation_messages
- **WHEN** a `file_diff` message is written to the `conversation_messages` table
- **THEN** it is stored with `type = "file_diff"` and `content` as a JSON-serialized `FileDiffPayload`

### Requirement: file_diff messages are excluded from LLM context
The system SHALL exclude `file_diff` messages from the message list assembled for LLM API calls. They SHALL NOT appear in `compactMessages` output.

#### Scenario: file_diff not forwarded to LLM
- **WHEN** `compactMessages` processes a conversation history containing `file_diff` rows
- **THEN** those rows are omitted from the returned array

### Requirement: FileDiffPayload captures structured change data
The `FileDiffPayload` type SHALL include: `operation` (one of `"write_file"`, `"patch_file"`, `"delete_file"`, `"rename_file"`), `path` (file path), `added` (count of added lines), `removed` (count of removed lines). Optionally: `to_path` (rename only), `is_new` (write_file creating a new file), `hunks` (array of `Hunk` objects).

A `Hunk` SHALL contain `old_start`, `new_start`, and `lines` (array of `HunkLine`). A `HunkLine` SHALL have `type` (`"added"`, `"removed"`, or `"context"`), `content` (the line text), and optional `old_line`/`new_line` numbers.

#### Scenario: Payload includes operation metadata
- **WHEN** a write tool executes successfully
- **THEN** the emitted `file_diff` message content parses to a `FileDiffPayload` with `operation`, `path`, `added`, and `removed` fields

#### Scenario: Hunks present for write, patch, and delete operations
- **WHEN** `write_file`, `patch_file`, or `delete_file` succeeds
- **THEN** the `FileDiffPayload` includes a `hunks` array with `HunkLine` entries typed `"added"`, `"removed"`, or `"context"`

#### Scenario: Hunks absent for rename
- **WHEN** a `rename_file` operation succeeds
- **THEN** the `FileDiffPayload` has no `hunks` field

### Requirement: FileDiff.vue renders a scrollable unified diff view
The system SHALL provide a `FileDiff.vue` component that accepts a `FileDiffPayload` prop and renders the diff inline without its own collapsible header (the parent `ToolCallGroup` provides the header). The diff body SHALL be scrollable with a fixed maximum height.

#### Scenario: Diff body is scrollable
- **WHEN** a `file_diff` payload with many lines is rendered
- **THEN** the diff body has a fixed `max-height` and scrolls vertically rather than expanding the page

#### Scenario: Added lines rendered green
- **WHEN** a hunk line has `type: "added"`
- **THEN** the row has a green background and a `+` sign prefix

#### Scenario: Removed lines rendered red
- **WHEN** a hunk line has `type: "removed"`
- **THEN** the row has a red background and a `-` sign prefix

#### Scenario: Context lines rendered neutral
- **WHEN** a hunk line has `type: "context"`
- **THEN** the row has no background colour and a space prefix

#### Scenario: rename_file shows path change only
- **WHEN** a `rename_file` `FileDiffPayload` is rendered
- **THEN** a simple row shows `path → to_path` with a "renamed" tag; no hunk body is shown

### Requirement: FileDiff.vue limits initial display to 50 lines with Load More controls
The system SHALL cap the initial rendered window at 50 lines across all hunks. If the total exceeds 50, Load More controls SHALL appear to expand the window progressively.

#### Scenario: Initial window shows first 50 lines
- **WHEN** a diff with more than 50 total hunk lines is rendered
- **THEN** only the first 50 lines are visible on initial render

#### Scenario: Load More ↓ expands downward
- **WHEN** lines exist below the current window and the user clicks "Load more"
- **THEN** the window extends by 25 lines downward and the new content is visible

#### Scenario: Load More ↑ expands upward
- **WHEN** lines exist above the current window (after Load More ↓ was used) and the user clicks the top "Load more"
- **THEN** the window extends by 25 lines upward and the scroll position moves to the top of the body so new lines are visible

#### Scenario: No Load More when all lines fit
- **WHEN** the total hunk lines is 50 or fewer
- **THEN** no Load More button is shown

### Requirement: Hunk header shows accurate line numbers for the visible window
The system SHALL display a `@@ -oldStart +newStart @@` header for each hunk group in the rendered window. The line numbers SHALL reflect the first *visible* line of the hunk, not the hunk's nominal start.

#### Scenario: Partial hunk shows adjusted header
- **WHEN** only a portion of a hunk is visible (e.g. after Load More scroll)
- **THEN** the `@@` header shows the line numbers of the first visible line in that hunk portion, not the original `old_start`/`new_start`

### Requirement: ToolCallGroup.vue shows +N/-N stat badges for write operations
The system SHALL render green `+N` and red `-N` count badges in the `ToolCallGroup` header for any tool entry that has an associated `file_diff` payload.

#### Scenario: Header shows added/removed counts
- **WHEN** a tool entry has a `file_diff` with `added > 0` or `removed > 0`
- **THEN** the header row shows a green `+N` badge and/or a red `-N` badge

#### Scenario: No badge when counts are zero
- **WHEN** a tool entry has a `file_diff` with `added: 0` and `removed: 0` (e.g. rename)
- **THEN** no stat badges appear in the header
