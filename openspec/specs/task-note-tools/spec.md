## Purpose

Defines the LLM tool surface for note management: `create_note`, `list_notes`, and `update_note` registered in `common-tools.ts` and executed via the injected `NoteRepository` in `CommonToolContext.repos`.

## Requirements

### Requirement: LLM can create notes via create_note tool
The system SHALL expose a `create_note` tool in `COMMON_TOOL_DEFINITIONS`. It SHALL accept `content` (string, required — markdown body). On success it SHALL create a note row with `is_source_ai = 1` and return a confirmation string containing the new note's `id`.

#### Scenario: LLM creates a note
- **WHEN** the LLM calls `create_note` with `content: "## Decision\n..."`
- **THEN** a note is persisted with `is_source_ai = 1` and the tool returns a confirmation with the note id

#### Scenario: create_note without content is rejected
- **WHEN** the LLM calls `create_note` without a `content` field
- **THEN** `executeCommonTool` returns a validation error and no note is created

### Requirement: LLM can list notes via list_notes tool
The system SHALL expose a `list_notes` tool that returns all notes for the current `conversationId`. Each note SHALL include `id`, `content`, `isSourceAi`, `createdAt`, and `updatedAt`. Notes SHALL be ordered by `created_at ASC`. When no notes exist the tool SHALL return a descriptive empty message.

#### Scenario: LLM lists all notes for the conversation
- **WHEN** the LLM calls `list_notes` and two notes exist
- **THEN** the tool returns both notes in creation order with full content

#### Scenario: list_notes returns empty message when no notes exist
- **WHEN** the LLM calls `list_notes` and no notes have been created
- **THEN** the tool returns "No notes found for this conversation."

### Requirement: LLM can update notes via update_note tool
The system SHALL expose an `update_note` tool that accepts `id` (number, required) and `content` (string, required). On success it SHALL call `NoteRepository.updateNote` and return a confirmation string. Calling `update_note` without providing `id` SHALL return a validation error.

#### Scenario: LLM updates note content
- **WHEN** the LLM calls `update_note` with a valid `id` and new `content`
- **THEN** the note's content is updated and the tool returns a confirmation

#### Scenario: update_note without id is rejected
- **WHEN** the LLM calls `update_note` without `id`
- **THEN** `executeCommonTool` returns a validation error and no update occurs

#### Scenario: update_note with unknown id returns error
- **WHEN** the LLM calls `update_note` with an `id` that does not exist
- **THEN** the tool returns an error message indicating the note was not found

### Requirement: Note tools are available in all four engines
The `create_note`, `list_notes`, and `update_note` tools SHALL be included in `COMMON_TOOL_DEFINITIONS` and therefore available in the Claude, Copilot, Pi, and OpenCode engines. Each engine's context construction SHALL inject a `NoteRepository` instance at `repos.notes`. For the Pi engine specifically, all three note tool names SHALL appear in the SDK `tools` allowlist on both session creation (`defaultSessionFactory`) and session reuse (`setActiveToolsByName`).

#### Scenario: Note tools available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** `create_note`, `list_notes`, and `update_note` are registered with the SDK

#### Scenario: Note tools available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** `create_note`, `list_notes`, and `update_note` are in the registered tool list

#### Scenario: Note tools available in Pi engine on first execution
- **WHEN** the Pi engine processes the first execution of a new conversation
- **THEN** `create_note`, `list_notes`, and `update_note` are present in the SDK `tools` allowlist
- **AND** calling `create_note` from the LLM persists a note successfully

#### Scenario: Note tools available in Pi engine on subsequent executions
- **WHEN** the Pi engine processes the second or later execution of the same conversation
- **THEN** `create_note`, `list_notes`, and `update_note` remain present in the active tool set via `setActiveToolsByName`

#### Scenario: executeCommonTool dispatches to NoteRepository
- **WHEN** `executeCommonTool("create_note", { content: "hello" }, ctx)` is called
- **THEN** `ctx.repos.notes.createNote(...)` is called and the result is returned

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

### Requirement: update_note rejects empty content
The `update_note` tool SHALL reject a `content` argument that is empty or whitespace-only with the validation error `"Error: content is required"`, consistent with the `create_note` guard. The `content` SHALL be trimmed before the empty check.

#### Scenario: update_note with empty content string is rejected
- **WHEN** `executeCommonTool("update_note", { id: 1, content: "" }, ctx)` is called
- **THEN** the tool returns `"Error: content is required"` and no update is persisted

#### Scenario: update_note with whitespace-only content is rejected
- **WHEN** `executeCommonTool("update_note", { id: 1, content: "   " }, ctx)` is called
- **THEN** the tool returns `"Error: content is required"` and no update is persisted
