## MODIFIED Requirements

### Requirement: stream_events schema uses conversation_id as primary routing key
The `stream_events` table SHALL use `conversation_id` as the primary routing key with a NOT NULL constraint. The `task_id` column SHALL NOT exist in this table. All stream event writes SHALL supply `conversation_id`. Rows with NULL `conversation_id` from pre-migration installs are considered legacy data and SHALL be dropped during the cleanup migration.

The table schema SHALL be:
```
stream_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  execution_id    INTEGER NOT NULL,
  seq             INTEGER NOT NULL,
  block_id        TEXT NOT NULL,
  type            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  metadata        TEXT,
  parent_block_id TEXT,
  subagent_id     TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(conversation_id, seq)
)
```

Indexes:
- `idx_stream_events_conversation (conversation_id, seq)`
- `idx_stream_events_execution (execution_id, seq)`

The `idx_stream_events_task` index SHALL be removed.

#### Scenario: Stream event write requires conversation_id
- **WHEN** code attempts to insert a stream event without a `conversation_id`
- **THEN** the insert fails with a NOT NULL constraint violation

#### Scenario: Stream events queryable by conversation
- **WHEN** `getStreamEventsByConversation(conversationId)` is called
- **THEN** only rows where `conversation_id = conversationId` are returned, ordered by `seq`

#### Scenario: No task_id column exists
- **WHEN** the migration has run on a fresh or upgraded install
- **THEN** `PRAGMA table_info(stream_events)` shows no `task_id` column
