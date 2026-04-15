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
The system SHALL render green `+N` and red `-N` count badges in the `ToolCallGroup` header for any tool entry that has associated file-change data. Tool rows SHALL consume structured `tool_result.writtenFiles` as the canonical source and MAY fall back to legacy `file_diff` payloads for backward compatibility during migration.

#### Scenario: Header shows added/removed counts
- **WHEN** a tool entry has file-change data with `added > 0` or `removed > 0`
- **THEN** the header row shows a green `+N` badge and/or a red `-N` badge

#### Scenario: No badge when counts are zero
- **WHEN** a tool entry has file-change data with `added: 0` and `removed: 0` (e.g. rename)
- **THEN** no stat badges appear in the header

#### Scenario: Copilot file edit shows line-level changes
- **WHEN** a Copilot tool result describes a file edit and includes sufficient diff detail for the UI
- **THEN** the tool row renders added and removed lines instead of an empty output shell

#### Scenario: Fallback placeholder shown when no visible diff or output exists
- **WHEN** a write-oriented tool result contains no renderable diff detail and no readable output text
- **THEN** the expanded row renders the explicit no-output placeholder rather than an empty collapsible body

#### Scenario: Structured tool result takes precedence over legacy file_diff
- **WHEN** both structured `writtenFiles` and legacy `file_diff` are present for the same tool call
- **THEN** the UI renders the structured `writtenFiles` representation as the primary source

### Requirement: code_review is a first-class message type
The system SHALL define `"code_review"` as a valid `MessageType` in `rpc-types.ts`. The content of a `code_review` message SHALL be a JSON-serialized `CodeReviewPayload` containing the full set of hunk decisions submitted by the reviewer.

#### Scenario: code_review type is accepted in conversation_messages
- **WHEN** a code review is submitted
- **THEN** a message is stored with `type = "code_review"` and `content` as a JSON-serialized `CodeReviewPayload`

### Requirement: code_review messages are excluded from LLM compaction
The system SHALL exclude `code_review` messages from the message list assembled for LLM API calls. They SHALL NOT appear in `compactMessages` output. Instead, the review's actionable content is injected as a plain-text `"user"` role message to the model.

#### Scenario: code_review not forwarded raw to LLM
- **WHEN** `compactMessages` processes a conversation history containing a `code_review` message
- **THEN** the raw `code_review` row is omitted from the returned array

### Requirement: code_review messages are rendered as a distinct review summary card
The system SHALL render `code_review` messages in the conversation timeline as a collapsible review summary card (not as a plain user message bubble). The card SHALL show the reviewer's decision counts (rejected, change_requested, accepted) and expand to show per-file and per-hunk details.

#### Scenario: code_review renders as a card not a bubble
- **WHEN** a `code_review` message appears in the conversation timeline
- **THEN** a distinct styled card is rendered instead of the standard `MessageBubble`

#### Scenario: Card shows decision summary
- **WHEN** a code_review card is rendered
- **THEN** the collapsed state shows counts of rejected, change_requested, and accepted hunks across all files

