## Purpose

Defines the LLM tool surface for note management: `create_note`, `list_notes`, and `update_note` registered in `common-tools.ts` and executed via the injected `NoteRepository` in `CommonToolContext.repos`.

## Requirements

### Requirement: LLM can create notes via create_note tool
The system SHALL expose a `create_note` tool in `COMMON_TOOL_DEFINITIONS`. It SHALL accept `content` (string, required — markdown body) and `title` (string, optional — short label for the note). On success it SHALL create a note row with `is_source_ai = 1` and return a confirmation string containing the new note's `id` and title.

#### Scenario: LLM creates a note with title and content
- **WHEN** the LLM calls `create_note` with `title: "Architecture"` and `content: "## Decision\n..."`
- **THEN** a note is persisted with `is_source_ai = 1` and the tool returns a confirmation with the note id

#### Scenario: LLM creates a note with content only
- **WHEN** the LLM calls `create_note` with `content` only (no title)
- **THEN** the note is persisted with `title = NULL` and the tool returns confirmation

#### Scenario: create_note without content is rejected
- **WHEN** the LLM calls `create_note` without a `content` field
- **THEN** `executeCommonTool` returns a validation error and no note is created

### Requirement: LLM can list notes via list_notes tool
The system SHALL expose a `list_notes` tool that returns all notes for the current `conversationId`. Each note SHALL include `id`, `title`, `content`, `isSourceAi`, `createdAt`, and `updatedAt`. Notes SHALL be ordered by `created_at ASC`. When no notes exist the tool SHALL return a descriptive empty message.

#### Scenario: LLM lists all notes for the conversation
- **WHEN** the LLM calls `list_notes` and two notes exist
- **THEN** the tool returns both notes in creation order with full content

#### Scenario: list_notes returns empty message when no notes exist
- **WHEN** the LLM calls `list_notes` and no notes have been created
- **THEN** the tool returns "No notes found for this conversation."

### Requirement: LLM can update notes via update_note tool
The system SHALL expose an `update_note` tool that accepts `note_id` (number, required), and at least one of `content` (string) or `title` (string or null). On success it SHALL call `NoteRepository.updateNote` and return a confirmation string. Calling `update_note` without providing `note_id` SHALL return a validation error.

#### Scenario: LLM updates note content
- **WHEN** the LLM calls `update_note` with a valid `note_id` and new `content`
- **THEN** the note's content is updated and the tool returns a confirmation

#### Scenario: LLM clears note title by passing null
- **WHEN** the LLM calls `update_note` with `title: null`
- **THEN** the note's title is set to NULL in the database

#### Scenario: update_note without note_id is rejected
- **WHEN** the LLM calls `update_note` without `note_id`
- **THEN** `executeCommonTool` returns a validation error and no update occurs

#### Scenario: update_note with unknown id returns error
- **WHEN** the LLM calls `update_note` with a `note_id` that does not exist
- **THEN** the tool returns an error message indicating the note was not found

### Requirement: Note tools are available in all four engines
The `create_note`, `list_notes`, and `update_note` tools SHALL be included in `COMMON_TOOL_DEFINITIONS` and therefore available in the Claude, Copilot, Pi, and OpenCode engines. Each engine's context construction SHALL inject a `NoteRepository` instance at `repos.notes`.

#### Scenario: Note tools available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** `create_note`, `list_notes`, and `update_note` are registered with the SDK

#### Scenario: Note tools available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** `create_note`, `list_notes`, and `update_note` are in the registered tool list

#### Scenario: executeCommonTool dispatches to NoteRepository
- **WHEN** `executeCommonTool("create_note", { content: "hello" }, ctx)` is called
- **THEN** `ctx.repos.notes.createNote(...)` is called and the result is returned
