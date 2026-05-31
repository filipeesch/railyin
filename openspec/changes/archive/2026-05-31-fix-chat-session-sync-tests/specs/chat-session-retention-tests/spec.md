## ADDED Requirements

### Requirement: Hard-delete retention job is unit-tested with cascade verification
The backend retention job SHALL have tests proving it hard-deletes archived sessions older than 7 days and that deleting a session cascades to child tables.

#### Scenario: RJ-5a — archived session past 7 days is deleted
- **WHEN** a `chat_sessions` row has `status = 'archived'` and `archived_at` is 8 days ago
- **THEN** after `job.runNow()`, the row no longer exists in `chat_sessions`

#### Scenario: RJ-5b — archived session within 7 days is preserved
- **WHEN** a `chat_sessions` row has `status = 'archived'` and `archived_at` is 3 days ago
- **THEN** after `job.runNow()`, the row still exists in `chat_sessions`

#### Scenario: RJ-5c — active session is never deleted
- **WHEN** a `chat_sessions` row has `status = 'idle'` and any `archived_at`
- **THEN** after `job.runNow()`, the row still exists in `chat_sessions`

#### Scenario: RJ-5d — deletion cascades to conversation_messages
- **WHEN** a to-be-deleted session has linked `conversation_messages` rows
- **THEN** after `job.runNow()`, those `conversation_messages` rows are gone

#### Scenario: RJ-5e — deletion cascades to stream_events
- **WHEN** a to-be-deleted session has linked `stream_events` rows
- **THEN** after `job.runNow()`, those `stream_events` rows are gone

### Requirement: Migration 048 is tested on the real migration stack
Migration `048_chat_cascade.ts` SHALL be verified by running the full migration stack on a real file-based DB.

#### Scenario: M-048a — migration applies without error
- **WHEN** `runMigrations()` is called on a DB without migration 048 applied
- **THEN** it completes without throwing

#### Scenario: M-048b — cascade on conversation_messages after migration
- **WHEN** a `conversations` row is deleted after migration 048
- **THEN** all linked `conversation_messages` rows are also deleted

#### Scenario: M-048c — cascade on stream_events after migration
- **WHEN** a `conversations` row is deleted after migration 048
- **THEN** all linked `stream_events` rows are also deleted

### Requirement: Test schema in helpers.ts mirrors production cascade constraints
The in-memory DB created by `initDb()` in `src/bun/test/helpers.ts` SHALL have `ON DELETE CASCADE` on `conversation_messages.conversation_id` and `stream_events.conversation_id` to match production schema after migration 048.

#### Scenario: helpers schema — cascade on conversation_messages
- **WHEN** `initDb()` creates the test DB and a `conversations` row is deleted
- **THEN** linked `conversation_messages` rows are deleted automatically

#### Scenario: helpers schema — cascade on stream_events
- **WHEN** `initDb()` creates the test DB and a `conversations` row is deleted
- **THEN** linked `stream_events` rows are deleted automatically
