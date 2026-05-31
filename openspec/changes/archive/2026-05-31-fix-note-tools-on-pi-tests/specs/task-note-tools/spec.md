## ADDED Requirements

### Requirement: NoteRepository CRUD operations are correct
The test suite SHALL verify all `NoteRepository` methods — `createNote`, `listByConversation`, `updateNote`, and `deleteNote` — against an in-memory SQLite database.

#### Scenario: NR-1 — createNote returns a note with id and content
- **WHEN** `repo.createNote({ conversationId, content: "hello", isSourceAi: false })` is called
- **THEN** the returned object has a numeric `id`, the correct `content`, and `conversationId`

#### Scenario: NR-2 — listByConversation returns all notes for a conversation
- **WHEN** two notes are created for the same `conversationId` and one for a different id
- **THEN** `listByConversation(conversationId)` returns exactly 2 notes scoped to that id

#### Scenario: NR-3 — updateNote changes content
- **WHEN** `repo.updateNote(id, "new content")` is called
- **THEN** `listByConversation` returns the note with `content: "new content"`

#### Scenario: NR-4 — deleteNote removes the row
- **WHEN** `repo.deleteNote(id)` is called
- **THEN** the note no longer appears in `listByConversation` results

#### Scenario: NR-5 — notes scoped to conversation — no cross-leak
- **WHEN** notes exist for two separate `conversationId` values
- **THEN** `listByConversation(id1)` returns only notes for `id1`

#### Scenario: NR-6 — createNote with isSourceAi true persists flag
- **WHEN** `createNote({ ..., isSourceAi: true })` is called
- **THEN** the returned note has `isSourceAi: true`

#### Scenario: NR-7 — updateNote on non-existent id is a no-op (no throw)
- **WHEN** `repo.updateNote(99999, "content")` is called on an id that does not exist
- **THEN** no exception is thrown

#### Scenario: NR-8 — deleteNote on non-existent id is a no-op (no throw)
- **WHEN** `repo.deleteNote(99999)` is called on an id that does not exist
- **THEN** no exception is thrown

### Requirement: executeCommonTool dispatches correctly for all note tools
The test suite SHALL verify that `executeCommonTool` correctly routes `create_note`, `list_notes`, and `update_note` calls to `NoteRepository` and returns expected output formats.

#### Scenario: CNT-1 — create_note returns success message
- **WHEN** `executeCommonTool("create_note", { content: "my note" }, ctx)` is called
- **THEN** the result is a string containing the new note's id

#### Scenario: CNT-2 — create_note persists via NoteRepository
- **WHEN** `executeCommonTool("create_note", { content: "my note" }, ctx)` is called
- **THEN** `ctx.repos.notes.createNote(...)` is invoked and the note appears in the DB

#### Scenario: CNT-3 — create_note with empty content returns validation error
- **WHEN** `executeCommonTool("create_note", { content: "" }, ctx)` is called
- **THEN** the result is `"Error: content is required"`

#### Scenario: CNT-4 — create_note with whitespace-only content returns validation error
- **WHEN** `executeCommonTool("create_note", { content: "   " }, ctx)` is called
- **THEN** the result is `"Error: content is required"`

#### Scenario: LNT-1 — list_notes returns empty string when no notes exist
- **WHEN** `executeCommonTool("list_notes", {}, ctx)` is called with no notes in DB
- **THEN** the result is an empty string or a message indicating no notes

#### Scenario: LNT-2 — list_notes returns all notes for the conversation
- **WHEN** two notes exist for the conversation and `list_notes` is called
- **THEN** the result contains both notes' content

#### Scenario: LNT-3 — list_notes does not return notes from other conversations
- **WHEN** notes exist for a different `conversationId`
- **THEN** those notes do not appear in the result

#### Scenario: LNT-4 — list_notes includes note ids in output
- **WHEN** `list_notes` is called and notes exist
- **THEN** the result includes the numeric id of each note (for use with update_note/delete_note)

#### Scenario: UNT-1 — update_note returns success message
- **WHEN** `executeCommonTool("update_note", { id: existingId, content: "updated" }, ctx)` is called
- **THEN** the result is a success string (does not start with "Error:")

#### Scenario: UNT-2 — update_note persists new content
- **WHEN** `executeCommonTool("update_note", { id: existingId, content: "updated" }, ctx)` is called
- **THEN** `list_notes` subsequently returns `"updated"` as the note content

#### Scenario: UNT-3 — update_note with empty content returns validation error
- **WHEN** `executeCommonTool("update_note", { id: existingId, content: "" }, ctx)` is called
- **THEN** the result is `"Error: content is required"` and the note content is unchanged

#### Scenario: UNT-4 — update_note with whitespace-only content returns validation error
- **WHEN** `executeCommonTool("update_note", { id: existingId, content: "  " }, ctx)` is called
- **THEN** the result is `"Error: content is required"` and the note content is unchanged

### Requirement: Note tool definitions are correctly registered
The test suite SHALL verify that all three note tools appear in `COMMON_TOOL_DEFINITIONS` with the required parameter definitions.

#### Scenario: CTR-N1 — create_note is present in COMMON_TOOL_DEFINITIONS
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected
- **THEN** an entry with `name: "create_note"` exists with a `content` parameter of type `string` marked required

#### Scenario: CTR-N2 — list_notes is present in COMMON_TOOL_DEFINITIONS
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected
- **THEN** an entry with `name: "list_notes"` exists with no required parameters

#### Scenario: CTR-N3 — update_note is present in COMMON_TOOL_DEFINITIONS
- **WHEN** `COMMON_TOOL_DEFINITIONS` is inspected
- **THEN** an entry with `name: "update_note"` exists with `id` (integer, required) and `content` (string, required) parameters

#### Scenario: CTR-N4 — all three note tool names are in COMMON_TOOL_NAMES
- **WHEN** `COMMON_TOOL_NAMES` is inspected
- **THEN** it includes `"create_note"`, `"list_notes"`, and `"update_note"`
