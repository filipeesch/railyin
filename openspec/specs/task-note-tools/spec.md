## Purpose

Defines the LLM tool surface for note management: `create_note`, `list_notes`, and `update_note` registered in `common-tools.ts` and executed via the injected `NoteRepository` in `CommonToolContext.repos`.

## Requirements

### Requirement: LLM can create notes via create_note tool
The system SHALL expose a `create_note` tool in `COMMON_TOOL_DEFINITIONS`. It SHALL accept `content` (string, required — markdown body) and `tags` (array of strings, optional — max 4 tags, each max 15 chars). On success it SHALL create a note row with `is_source_ai = 1` and return a confirmation string containing the new note's `id`. Tags SHALL be normalized (trim, lowercase, deduplicate) before storage.

#### Scenario: LLM creates a note with tags
- **WHEN** the LLM calls `create_note` with `content: "## Decision\n..."` and `tags: ["design"]`
- **THEN** a note is persisted with `is_source_ai = 1`, tags `["design"]`, and the tool returns a confirmation with the note id

#### Scenario: LLM creates a note without tags
- **WHEN** the LLM calls `create_note` with `content: "## Decision\n..."` and no `tags` field
- **THEN** a note is persisted with `is_source_ai = 1` and `tags = null`

#### Scenario: create_note without content is rejected
- **WHEN** the LLM calls `create_note` without a `content` field
- **THEN** `executeCommonTool` returns a validation error and no note is created

#### Scenario: create_note with tags normalizes values
- **WHEN** the LLM calls `create_note` with `tags: [" Design ", "TODO"]`
- **THEN** tags are stored as `["design", "todo"]`

#### Scenario: create_note with more than 4 tags limits to 4
- **WHEN** the LLM calls `create_note` with `tags: ["a", "b", "c", "d", "e"]`
- **THEN** tags are stored as `["a", "b", "c", "d"]`

### Requirement: LLM can list notes via list_notes tool
The system SHALL expose a `list_notes` tool that accepts an optional `tags` parameter (array of strings). When `tags` is provided, it SHALL return notes that have ANY of the specified tags (OR matching). When omitted, it SHALL return all notes for the current `conversationId`. Each note SHALL include `id`, `content`, `isSourceAi`, `createdAt`, `updatedAt`, and `tags`. Notes SHALL be ordered by `created_at ASC`. When no notes exist the tool SHALL return a descriptive empty message.

#### Scenario: LLM lists all notes for the conversation
- **WHEN** the LLM calls `list_notes` and two notes exist
- **THEN** the tool returns both notes in creation order with full content and tags

#### Scenario: LLM lists notes filtered by tags
- **WHEN** the LLM calls `list_notes` with `tags: ["design"]` and notes exist with tags `["design"]` and `["architecture"]`
- **THEN** only notes with `"design"` tag are returned

#### Scenario: LLM lists notes with multiple tag filters (OR matching)
- **WHEN** the LLM calls `list_notes` with `tags: ["design", "architecture"]`
- **THEN** notes with either `"design"` OR `"architecture"` tags are returned

#### Scenario: list_notes returns empty message when no notes exist
- **WHEN** the LLM calls `list_notes` and no notes have been created
- **THEN** the tool returns "No notes found for this conversation."

#### Scenario: list_notes includes tags in response
- **WHEN** the LLM calls `list_notes` and notes exist with tags
- **THEN** each note in the response includes a `tags` field

### Requirement: LLM can update notes via update_note tool
The system SHALL expose an `update_note` tool that accepts `id` (number, required), `content` (string, optional), and `tags` (array of strings, optional). On success it SHALL call `NoteRepository.updateNote` and return a confirmation string. If `tags` is provided, it SHALL replace existing tags. If `tags` is omitted, existing tags SHALL be preserved. Tags SHALL be normalized before storage. At least one of `content` or `tags` must be provided; if both are empty/missing, the tool SHALL return a validation error.

#### Scenario: LLM updates note content without changing tags
- **WHEN** the LLM calls `update_note` with `id: 1` and `content: "updated"` but no `tags`
- **THEN** the note content is updated and existing tags are preserved

#### Scenario: LLM updates note tags without changing content
- **WHEN** the LLM calls `update_note` with `id: 1` and `tags: ["new-tag"]` but no `content`
- **THEN** the note tags are replaced with `["new-tag"]` and content is preserved

#### Scenario: LLM updates both content and tags
- **WHEN** the LLM calls `update_note` with `id: 1`, `content: "updated"`, and `tags: ["design"]`
- **THEN** both content and tags are updated

#### Scenario: update_note with empty tags array preserves existing tags
- **WHEN** the LLM calls `update_note` with `tags: []` on a note with existing tags
- **THEN** the note's tags are unchanged

#### Scenario: update_note with empty content string is rejected
- **WHEN** `executeCommonTool("update_note", { id: 1, content: "" }, ctx)` is called
- **THEN** the tool returns `"Error: content is required"` and no update is persisted

#### Scenario: update_note with whitespace-only content is rejected
- **WHEN** `executeCommonTool("update_note", { id: 1, content: "   " }, ctx)` is called
- **THEN** the tool returns `"Error: content is required"` and no update is persisted

### Requirement: NoteRepository supports tag operations
The system SHALL extend `NoteRepository` to support tags in `createNote`, `updateNote`, and `listByConversation` methods. Tags SHALL be stored as JSON-serialized arrays in the `tags` column. The repository SHALL normalize tags (trim, lowercase, deduplicate, limit to 4, truncate to 15 chars) before storage.

#### Scenario: createNote with tags persists normalized tags
- **WHEN** `createNote(conversationId, { content: "...", tags: [" Design "] })` is called
- **THEN** the note row has `tags = '["design"]'`

#### Scenario: updateNote with tags replaces existing tags
- **WHEN** `updateNote(id, { tags: ["new"] })` is called on a note with tags `["old"]`
- **THEN** the note has tags `["new"]`

#### Scenario: listByConversation with tag filter returns matching notes
- **WHEN** `listByConversation(conversationId, { tagFilter: ["design"] })` is called
- **THEN** only notes with `"design"` tag are returned

#### Scenario: listByConversation without tag filter returns all notes
- **WHEN** `listByConversation(conversationId)` is called without tag filter
- **THEN** all notes for the conversation are returned

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
- **THEN** an entry with `name: "update_note"` exists with `id` (integer, required), `content` (string, optional), and `tags` (array, optional) parameters

#### Scenario: CTR-N4 — all three note tool names are in COMMON_TOOL_NAMES
- **WHEN** `COMMON_TOOL_NAMES` is inspected
- **THEN** it includes `"create_note"`, `"list_notes"`, and `"update_note"`

### Requirement: create_note and update_note descriptions require explicit user intent
`create_note` and `update_note` tool descriptions in `COMMON_TOOL_DEFINITIONS` SHALL include a warning that the tool is only to be used when the user EXPLICITLY asks (mirroring the board tool pattern). `create_note` SHALL start with "⚠️ NOTE TOOL — use ONLY when the user EXPLICITLY asks to create a note." `update_note` SHALL start with "⚠️ NOTE TOOL — use ONLY when the user EXPLICITLY asks to edit or update a note."

#### Scenario: create_note description requires explicit intent
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `create_note` tool
- **THEN** the description contains "EXPLICITLY asks"

#### Scenario: update_note description requires explicit intent
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `update_note` tool
- **THEN** the description contains "EXPLICITLY asks"

#### Scenario: create_note retains functional description
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `create_note` tool
- **THEN** the description still explains note scope, content, and visibility

#### Scenario: update_note retains functional description
- **WHEN** `COMMON_TOOL_DEFINITIONS` finds the `update_note` tool
- **THEN** the description still explains updating content/tags and calling list_notes first
