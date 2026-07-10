## Purpose

Defines the persistence model, repository interface, RPC contract, and frontend UI for free-form markdown notes scoped to a conversation.

## Requirements

### Requirement: initDb test helper includes task_notes table
`initDb()` in `src/bun/test/helpers.ts` MUST create a `task_notes` table so that all in-memory test databases include the complete schema for note-related tests. This is a maintenance addition following the same pattern as `task_todos`, `decision_records`, and `stream_events`.

#### Scenario: initDb creates task_notes table
- **WHEN** `initDb()` is called
- **THEN** the returned database has a `task_notes` table with columns `id`, `conversation_id`, `title`, `content`, `is_source_ai`, `created_at`, `updated_at`

#### Scenario: NoteRepository operates correctly on initDb database
- **WHEN** `new NoteRepository(initDb())` is constructed
- **THEN** `createNote` and `listByConversation` execute without errors

### Requirement: Notes are persisted per conversation in SQLite
The system SHALL maintain a `task_notes` table scoped to `conversation_id` so that both task-backed and standalone chat conversations can store notes without requiring a `task_id`.

`task_notes` SHALL have columns: `id` (INTEGER PK AUTOINCREMENT), `conversation_id` (INTEGER NOT NULL, FK to `conversations(id)` ON DELETE CASCADE), `content` (TEXT NOT NULL), `is_source_ai` (INTEGER NOT NULL DEFAULT 0), `created_at` (TEXT NOT NULL DEFAULT datetime('now')), `updated_at` (TEXT NOT NULL DEFAULT datetime('now')).

Delete operations SHALL be hard deletes (physical row removal). The `ON DELETE CASCADE` on `conversation_id` SHALL ensure all notes are automatically removed when their parent conversation is deleted. No soft-delete column SHALL exist.

A DB migration SHALL create the `task_notes` table with the correct schema and an index on `conversation_id` for efficient lookup.

#### Scenario: Note persisted for task conversation
- **WHEN** a note is created for a task-backed conversation
- **THEN** the row is stored with the conversation's `conversation_id` and can be retrieved by that id

#### Scenario: Notes cascade-deleted when conversation is removed
- **WHEN** a conversation (and its parent task) is deleted from the database
- **THEN** all `task_notes` rows with that `conversation_id` are automatically removed by the DB cascade

#### Scenario: Hard delete removes the row
- **WHEN** `NoteRepository.deleteNote(id)` is called
- **THEN** the row is physically removed from `task_notes` and is no longer returned by any query

#### Scenario: Migration runs cleanly on a fresh database
- **WHEN** the migration runner executes on a fresh SQLite database
- **THEN** `task_notes` is created with correct columns, FK constraint, and index

### Requirement: NoteRepository encapsulates all note persistence logic
The system SHALL provide a `NoteRepository` class at `src/bun/db/repositories/note-repository.ts` that exposes:
- `createNote(conversationId, input: { content: string; isSourceAi?: boolean }): TaskNote`
- `updateNote(id, input: { content?: string }): TaskNote`
- `deleteNote(id): void` — hard delete
- `listByConversation(conversationId): TaskNote[]` — ordered by `created_at ASC`

The repository SHALL be constructed with a `Database` instance injected via constructor (same pattern as `DecisionRepository`). No method SHALL access global state.

#### Scenario: createNote persists a new note
- **WHEN** `createNote(conversationId, { content: "## Plan\n..." })` is called
- **THEN** a row is inserted into `task_notes` with `is_source_ai = 0` and the note is returned with its generated `id`

#### Scenario: createNote with isSourceAi sets the flag
- **WHEN** `createNote(conversationId, { content: "...", isSourceAi: true })` is called
- **THEN** the row has `is_source_ai = 1`

#### Scenario: updateNote patches content only
- **WHEN** `updateNote(id, { content: "Updated content" })` is called
- **THEN** `content` and `updated_at` are changed

#### Scenario: listByConversation returns notes in creation order
- **WHEN** three notes are created for a conversation at different times
- **THEN** `listByConversation` returns them ordered oldest-first

### Requirement: RPC handlers expose note operations
The system SHALL provide RPC handlers at `src/bun/handlers/notes.ts` exposing four methods registered in `src/bun/index.ts`:
- `"notes.list"` — params: `{ conversationId: number }`, response: `TaskNote[]`
- `"notes.create"` — params: `{ conversationId: number; content: string }`, response: `TaskNote`
- `"notes.update"` — params: `{ id: number; content?: string }`, response: `TaskNote`
- `"notes.delete"` — params: `{ id: number }`, response: `void`

Shared types SHALL be declared in `src/shared/rpc-types.ts` as `TaskNote` and registered in the `RpcMethods` map.

#### Scenario: notes.list returns notes for conversation
- **WHEN** `notes.list` is called with a valid `conversationId`
- **THEN** all notes for that conversation are returned in creation order

#### Scenario: notes.create returns the created note
- **WHEN** `notes.create` is called with `conversationId` and `content`
- **THEN** a new `TaskNote` is returned with the provided values and a generated `id`

#### Scenario: notes.delete removes the note
- **WHEN** `notes.delete` is called with a valid `noteId`
- **THEN** the note is hard-deleted and subsequent `notes.list` does not include it

### Requirement: Notes tab and CRUD UI in TaskChatView
The system SHALL add a **Notes** tab to `TaskChatView.vue` after the Decisions tab. The tab SHALL render a `NotesPanel.vue` component when active.

`NotesPanel.vue` SHALL display all notes for the current `conversationId`, each rendering its `content` as markdown. A **"+ New"** button SHALL open `NoteDetailOverlay.vue` for creating a new note. Clicking an existing note SHALL open the overlay in edit mode.

`NoteDetailOverlay.vue` SHALL provide a markdown textarea (required). It SHALL expose **Save** and **Cancel** actions; in edit mode it SHALL also expose a **Delete** action that prompts for confirmation before hard-deleting the note via `notes.delete`.

The Notes panel SHALL re-fetch notes when a `task.updated` WebSocket event is received, ensuring the panel reflects notes created by the LLM during the last execution.

#### Scenario: Notes tab visible in TaskChatView
- **WHEN** a task chat view is open
- **THEN** a "Notes" tab button is visible after "Decisions" in the tab bar

#### Scenario: Notes panel lists existing notes
- **WHEN** the Notes tab is selected and notes exist for the conversation
- **THEN** each note's content is rendered as markdown in the panel

#### Scenario: User creates a note via overlay
- **WHEN** the user clicks "+ New", fills in content, and clicks Save
- **THEN** `notes.create` is called and the new note appears in the panel

#### Scenario: User edits a note via overlay
- **WHEN** the user clicks an existing note, edits its content, and clicks Save
- **THEN** `notes.update` is called and the updated note is reflected in the panel

#### Scenario: User deletes a note
- **WHEN** the user clicks the delete button on a note item
- **THEN** `notes.delete` is called and the note is removed from the panel

#### Scenario: Panel refreshes after LLM execution
- **WHEN** a `task.updated` WebSocket event is received while the Notes tab is active
- **THEN** the panel re-fetches notes and displays any notes created or updated during the execution
