## Purpose
Defines the background job that hard-deletes archived chat sessions and all their linked data after a retention window.

## Requirements

### Requirement: Archived sessions are hard-deleted after 7 days
The system SHALL hard-delete chat sessions with `status = 'archived'` and `archived_at` older than 7 days. Deletion SHALL cascade to all linked data: `conversations`, `conversation_messages`, `executions`, and `decision_records` belonging to the deleted session's conversation. If the session's conversation is file-backed, the job SHALL also delete that conversation's `.jsonl` file, its `.meta.json` sidecar, and any associated debug log files from disk.

#### Scenario: Archived session is deleted after retention window
- **WHEN** the background retention job fires and a chat session has been archived for more than 7 days
- **THEN** the session row and all linked conversation data are deleted from the database

#### Scenario: Recently archived session is preserved
- **WHEN** the background retention job fires and a chat session has been archived less than 7 days ago
- **THEN** the session and its data are not deleted

#### Scenario: Active sessions are never deleted
- **WHEN** the background retention job fires
- **THEN** sessions with `status != 'archived'` are not deleted regardless of age

#### Scenario: File-backed session's conversation file is deleted from disk
- **WHEN** the background retention job hard-deletes an archived chat session whose conversation is file-backed
- **THEN** the conversation's `.jsonl` file, `.meta.json` sidecar, and any debug log files for its executions are deleted from disk in addition to the SQL row deletes

#### Scenario: Legacy SQLite-backed session's deletion does not attempt file cleanup
- **WHEN** the background retention job hard-deletes an archived chat session whose conversation predates this change and is still SQLite-backed
- **THEN** only the existing SQL cascade deletes run; no file deletion is attempted

### Requirement: Cascade deletes cover all chat-owned child data
The system SHALL ensure that deleting a `chat_sessions` row (via its linked `conversations` row) removes all associated `conversation_messages`, `executions`, and `decision_records` through `ON DELETE CASCADE` constraints, for sessions whose conversation is still SQLite-backed. For file-backed conversations, message removal is achieved by deleting the conversation's file rather than by a `conversation_messages` cascade.

#### Scenario: Deleting session removes conversation messages (legacy)
- **WHEN** a chat session row with a SQLite-backed conversation is deleted
- **THEN** all `conversation_messages` rows for that session's `conversation_id` are also deleted

#### Scenario: Deleting session removes the conversation file (file-backed)
- **WHEN** a chat session row with a file-backed conversation is deleted
- **THEN** the conversation's `.jsonl` and `.meta.json` files are deleted from disk as part of the same deletion operation

### Requirement: Retention job runs on a recurring timer
The system SHALL run the archived-session hard-delete job on a recurring interval (every hour) alongside the existing auto-archive job. No manual trigger is required.

#### Scenario: Job fires periodically
- **WHEN** the Bun process is running
- **THEN** archived sessions older than 7 days are hard-deleted approximately every hour
