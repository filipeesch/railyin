# Task Note Tests

## Purpose

Unit and integration test coverage for the `add-task-notes` feature: NoteRepository unit tests, NoteHandler integration tests, LLM note tool tests, and common tool registration coverage.

## Requirements

### Requirement: NoteRepository unit tests
`NoteRepository` SHALL be covered by unit tests using an in-memory SQLite database created by `initDb()` from `src/bun/test/helpers.ts`.

#### Scenario: createNote persists a row and returns the full domain object
- **WHEN** `createNote({ conversationId, content: "hello", isSourceAi: false })` is called
- **THEN** the returned object has `id`, `conversationId`, `title: null`, `content: "hello"`, `isSourceAi: false`, `createdAt`, `updatedAt`

#### Scenario: createNote with an explicit title persists it
- **WHEN** `createNote({ conversationId, title: "Summary", content: "body" })` is called
- **THEN** the returned object has `title: "Summary"`

#### Scenario: createNote with isSourceAi=true persists the flag
- **WHEN** `createNote({ conversationId, content: "llm note", isSourceAi: true })` is called
- **THEN** the returned object has `isSourceAi: true`

#### Scenario: listByConversation returns empty array for unknown conversation
- **WHEN** `listByConversation(99999)` is called
- **THEN** the result is `[]`

#### Scenario: listByConversation returns notes in insertion order
- **WHEN** two notes are created and `listByConversation` is called
- **THEN** the first-inserted note appears first (ordered by `created_at ASC`)

#### Scenario: listByConversation does not return notes from other conversations
- **WHEN** notes exist for conversation A and B, and `listByConversation(A)` is called
- **THEN** only notes for conversation A are returned

#### Scenario: updateNote patches content
- **WHEN** `updateNote(id, { content: "new body" })` is called
- **THEN** the note's `content` is updated and `updated_at` is bumped

#### Scenario: updateNote clears title with null
- **WHEN** a note with `title: "Old"` has `updateNote(id, { title: null })` called
- **THEN** the note's `title` is `null`

#### Scenario: updateNote for nonexistent id returns null
- **WHEN** `updateNote(999, { content: "x" })` is called on an empty DB
- **THEN** the result is `null`

#### Scenario: deleteNote removes the row
- **WHEN** `deleteNote(id)` is called for an existing note
- **THEN** subsequent `listByConversation` does not include that note

#### Scenario: deleteNote is idempotent for nonexistent id
- **WHEN** `deleteNote(999)` is called when no note with that id exists
- **THEN** no error is thrown

#### Scenario: cascade delete removes notes when conversation is deleted
- **WHEN** the parent `conversations` row is deleted from the DB
- **THEN** all `task_notes` rows with that `conversation_id` are removed automatically

### Requirement: NoteHandler integration tests
`noteHandlers(db)` SHALL be covered by integration tests using `initDb()` and `seedProjectAndTask()`.

#### Scenario: notes.list returns empty array for new conversation
- **WHEN** `notes.list({ conversationId })` is called with no notes seeded
- **THEN** the result is `[]`

#### Scenario: notes.list returns all notes for a conversation
- **WHEN** two notes are created for a conversation and `notes.list` is called
- **THEN** both notes are returned

#### Scenario: notes.list does not return notes from other conversations
- **WHEN** notes exist for two conversations and `notes.list` is called for one
- **THEN** only the correct conversation's notes are returned

#### Scenario: notes.create returns the new note
- **WHEN** `notes.create({ conversationId, title: "T", content: "C" })` is called
- **THEN** the response is the full `TaskNote` object with all fields populated

#### Scenario: notes.update patches and returns the updated note
- **WHEN** `notes.update({ id, content: "updated" })` is called
- **THEN** the response has `content: "updated"` and an updated `updatedAt`

#### Scenario: notes.update with title null clears the title
- **WHEN** `notes.update({ id, title: null })` is called for a note with a title
- **THEN** the response has `title: null`

#### Scenario: notes.delete removes the note
- **WHEN** `notes.delete({ id })` is called
- **THEN** subsequent `notes.list` does not include that note

#### Scenario: notes.delete for unknown id returns not-found error
- **WHEN** `notes.delete({ id: 999 })` is called with no such note
- **THEN** an error response with a not-found message is returned

### Requirement: LLM note tool tests
`create_note`, `list_notes`, and `update_note` tools SHALL be covered by tests using `executeCommonTool` with a `CommonToolContext` constructed via a `commonCtx()` factory in `note-tools.test.ts`. The context MUST include `repos.notes: new NoteRepository(db)`.

#### Scenario: create_note without content returns error string
- **WHEN** `executeCommonTool("create_note", {}, ctx)` is called without `content`
- **THEN** the result is a non-empty error string describing the missing field

#### Scenario: create_note with content persists note and sets isSourceAi=true
- **WHEN** `executeCommonTool("create_note", { content: "my note" }, ctx)` is called
- **THEN** a note exists in the DB with `content: "my note"` and `is_source_ai = 1`

#### Scenario: create_note with title and content persists both
- **WHEN** `executeCommonTool("create_note", { title: "T", content: "C" }, ctx)` is called
- **THEN** the note has `title: "T"` and `content: "C"`

#### Scenario: list_notes with no notes returns empty-state message
- **WHEN** `executeCommonTool("list_notes", {}, ctx)` is called with no notes in the DB
- **THEN** the result is a non-empty string indicating no notes found

#### Scenario: list_notes with existing notes returns their content
- **WHEN** two notes exist and `executeCommonTool("list_notes", {}, ctx)` is called
- **THEN** the result string contains the title or content of both notes

#### Scenario: update_note without note_id returns error string
- **WHEN** `executeCommonTool("update_note", { content: "x" }, ctx)` is called without `note_id`
- **THEN** the result is a non-empty error string

#### Scenario: update_note with valid id updates the note
- **WHEN** a note exists and `executeCommonTool("update_note", { note_id: id, content: "new" }, ctx)` is called
- **THEN** the note's content is updated in the DB

#### Scenario: update_note with title null clears the title
- **WHEN** `executeCommonTool("update_note", { note_id: id, title: null }, ctx)` is called
- **THEN** the note's `title` becomes null in the DB

#### Scenario: update_note for nonexistent id returns error string
- **WHEN** `executeCommonTool("update_note", { note_id: 99999, content: "x" }, ctx)` is called
- **THEN** the result is a non-empty error string indicating not found

### Requirement: Common tool registration coverage for note tools
`COMMON_TOOL_DEFINITIONS` SHALL include all three note tools, and they SHALL appear in all engine tool formats.

#### Scenario: note tool names are present in COMMON_TOOL_DEFINITIONS
- **WHEN** `COMMON_TOOL_DEFINITIONS.map(t => t.name)` is evaluated
- **THEN** it contains `"create_note"`, `"list_notes"`, and `"update_note"`

#### Scenario: note tools appear in Copilot tool format
- **WHEN** `buildCopilotTools(ctx)` is called
- **THEN** the resulting array includes entries with names `create_note`, `list_notes`, `update_note`

#### Scenario: note tools appear in Claude tool server
- **WHEN** `buildClaudeToolServer(ctx)` is called
- **THEN** the resulting tool list includes entries with names `create_note`, `list_notes`, `update_note`
