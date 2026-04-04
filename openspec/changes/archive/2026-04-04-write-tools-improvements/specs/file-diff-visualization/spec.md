## ADDED Requirements

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
The `FileDiffPayload` type SHALL include: `operation` (one of `"write_file"`, `"patch_file"`, `"delete_file"`, `"rename_file"`), `path` (file path), `added` (count of added lines), `removed` (count of removed lines). Optionally: `to_path` (rename only), `is_new` (write_file creating a new file), `hunks` (array of `Hunk` objects, absent for delete and rename).

#### Scenario: Payload includes operation metadata
- **WHEN** a write tool executes successfully
- **THEN** the emitted `file_diff` message content parses to a `FileDiffPayload` with `operation`, `path`, `added`, and `removed` fields

#### Scenario: Hunks are absent for delete and rename
- **WHEN** a `delete_file` or `rename_file` operation succeeds
- **THEN** the `FileDiffPayload` has no `hunks` field

### Requirement: FileDiff.vue renders a collapsed diff component
The system SHALL provide a `FileDiff.vue` component that accepts a `FileDiffPayload` and renders it as a collapsed single-line summary. Clicking the summary SHALL expand an inline unified diff view.

#### Scenario: Collapsed state shows counts
- **WHEN** a `file_diff` message is rendered in `MessageBubble.vue`
- **THEN** a collapsed row appears showing the file path, `+added` count in green, and `-removed` count in red

#### Scenario: Clicking expands the diff
- **WHEN** the user clicks the collapsed diff row
- **THEN** the hunk lines are shown with line number gutters, added lines in green background, removed lines in red background, and context lines neutral

#### Scenario: 3 context lines surround each changed region
- **WHEN** a hunk is rendered in expanded state
- **THEN** up to 3 unchanged lines appear above and below each block of added/removed lines

#### Scenario: delete_file shows count only
- **WHEN** a `delete_file` `file_diff` message is rendered
- **THEN** the collapsed row shows `"deleted src/foo.ts (N lines)"` and no expanded diff is available

#### Scenario: rename_file shows path change only
- **WHEN** a `rename_file` `file_diff` message is rendered
- **THEN** the collapsed row shows `"src/old.ts → src/new.ts (renamed)"` and no expanded diff is available
