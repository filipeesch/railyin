## MODIFIED Requirements

### Requirement: Conversations are not required to have a task
A conversation's association with a task SHALL be optional. `conversations.task_id` SHALL be nullable. A conversation with `task_id = NULL` represents a standalone session conversation.

#### Scenario: Conversation created without task
- **WHEN** a chat session is created
- **THEN** a `conversations` row is inserted with `task_id = NULL` and a valid `conversation_id`

#### Scenario: Existing task conversations unaffected
- **WHEN** a task conversation is accessed
- **THEN** `task_id` is still present and all existing query paths continue to work

## ADDED Requirements

### Requirement: Conversation forking metadata
The system SHALL store `parent_conversation_id` and `forked_at_message_id` columns on the `conversations` table to support future conversation branching. Both SHALL default to NULL and have no functional effect in this change.

#### Scenario: Fork columns default to NULL
- **WHEN** a new conversation is created (task or session)
- **THEN** `parent_conversation_id` and `forked_at_message_id` are NULL

---

### Requirement: stream_events keyed by conversation_id
The `stream_events` table SHALL include a `conversation_id` column, backfilled from the associated conversation. All new stream event writes SHALL populate `conversation_id`. Queries for stream events SHALL support lookup by `conversation_id`.

#### Scenario: Stream events queryable by conversation
- **WHEN** `getStreamEvents(conversationId, afterSeq)` is called
- **THEN** events are returned filtered by `conversation_id = ?` and `seq > afterSeq`

#### Scenario: Backfill preserves existing events
- **WHEN** the migration runs
- **THEN** all existing `stream_events` rows have `conversation_id` populated via JOIN with `conversations`
