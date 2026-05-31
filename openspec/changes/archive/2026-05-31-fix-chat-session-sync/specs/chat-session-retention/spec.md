## Purpose
Defines the background job that hard-deletes archived chat sessions and all their linked data after a retention window.

## Requirements

### Requirement: Archived sessions are hard-deleted after 7 days
The system SHALL hard-delete chat sessions with `status = 'archived'` and `archived_at` older than 7 days. Deletion SHALL cascade to all linked data: `conversations`, `conversation_messages`, `stream_events`, `executions`, and `decision_records` belonging to the deleted session's conversation.

#### Scenario: Archived session is deleted after retention window
- **WHEN** the background retention job fires and a chat session has been archived for more than 7 days
- **THEN** the session row and all linked conversation data are deleted from the database

#### Scenario: Recently archived session is preserved
- **WHEN** the background retention job fires and a chat session has been archived less than 7 days ago
- **THEN** the session and its data are not deleted

#### Scenario: Active sessions are never deleted
- **WHEN** the background retention job fires
- **THEN** sessions with `status != 'archived'` are not deleted regardless of age

### Requirement: Cascade deletes cover all chat-owned child data
The system SHALL ensure that deleting a `chat_sessions` row (via its linked `conversations` row) removes all associated `conversation_messages`, `stream_events`, `executions`, and `decision_records` through `ON DELETE CASCADE` constraints.

#### Scenario: Deleting session removes conversation messages
- **WHEN** a chat session row is deleted
- **THEN** all `conversation_messages` rows for that session's `conversation_id` are also deleted

#### Scenario: Deleting session removes stream events
- **WHEN** a chat session row is deleted
- **THEN** all `stream_events` rows for that session's conversation are also deleted

### Requirement: Retention job runs on a recurring timer
The system SHALL run the archived-session hard-delete job on a recurring interval (every hour) alongside the existing auto-archive job. No manual trigger is required.

#### Scenario: Job fires periodically
- **WHEN** the Bun process is running
- **THEN** archived sessions older than 7 days are hard-deleted approximately every hour
