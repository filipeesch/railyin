## MODIFIED Requirements

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
The system SHALL expose an `update_note` tool that accepts `id` (number, required), `content` (string, required), and `tags` (array of strings, optional). On success it SHALL call `NoteRepository.updateNote` and return a confirmation string. If `tags` is provided, it SHALL replace existing tags. If `tags` is omitted, existing tags SHALL be preserved. Tags SHALL be normalized before storage. Calling `update_note` without providing `id` SHALL return a validation error.

#### Scenario: LLM updates note content without changing tags
- **WHEN** the LLM calls `update_note` with `id: 1` and `content: "updated"` but no `tags`
- **THEN** the note content is updated and existing tags are preserved

#### Scenario: LLM updates note tags without changing content
- **WHEN** the LLM calls `update_note` with `id: 1`, `content: "same"`, and `tags: ["new-tag"]`
- **THEN** the note tags are replaced with `["new-tag"]`

#### Scenario: LLM updates both content and tags
- **WHEN** the LLM calls `update_note` with `id: 1`, `content: "updated"`, and `tags: ["design"]`
- **THEN** both content and tags are updated

#### Scenario: update_note with empty tags array preserves existing tags
- **WHEN** the LLM calls `update_note` with `tags: []` on a note with existing tags
- **THEN** the note's tags are unchanged

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
