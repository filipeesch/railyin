## MODIFIED Requirements

### Requirement: initDb test helper includes task_notes table
`initDb()` in `src/bun/test/helpers.ts` MUST create a `task_notes` table so that all in-memory test databases include the complete schema for note-related tests. This is a maintenance addition following the same pattern as `task_todos`, `decision_records`, and `stream_events`.

#### Scenario: initDb creates task_notes table
- **WHEN** `initDb()` is called
- **THEN** the returned database has a `task_notes` table with columns `id`, `conversation_id`, `title`, `content`, `is_source_ai`, `created_at`, `updated_at`

#### Scenario: NoteRepository operates correctly on initDb database
- **WHEN** `new NoteRepository(initDb())` is constructed
- **THEN** `createNote` and `listByConversation` execute without errors
