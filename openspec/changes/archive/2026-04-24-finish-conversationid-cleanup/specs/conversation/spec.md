## ADDED Requirements

### Requirement: Conversation read APIs require conversationId
The system SHALL require `conversationId` for conversation-scoped read APIs. Message reads, persisted stream-event reads, and context-usage reads SHALL use `conversationId` directly and SHALL NOT depend on task-based aliases.

#### Scenario: Messages read with conversationId
- **WHEN** a caller requests conversation messages
- **THEN** the request includes `conversationId`
- **AND** the system returns messages for that conversation in append order

#### Scenario: Persisted stream events read with conversationId
- **WHEN** a caller requests persisted stream events for replay
- **THEN** the request includes `conversationId`
- **AND** the system returns the events for that conversation ordered by `seq`

#### Scenario: Context usage read with conversationId
- **WHEN** a caller requests context usage for a conversation
- **THEN** the request includes `conversationId`
- **AND** the system computes usage for that conversation without requiring a task identifier

### Requirement: All new stream-event writes populate conversation_id
The `stream_events` table SHALL treat `conversation_id` as the canonical conversation lookup key. All new persisted stream-event writes SHALL populate `conversation_id`, including rows emitted for standalone chat sessions where `task_id` is null.

#### Scenario: Task execution persists stream events with conversation_id
- **WHEN** a task execution persists stream events
- **THEN** each persisted row includes the task's `conversation_id`

#### Scenario: Standalone session execution persists stream events with conversation_id
- **WHEN** a standalone chat session persists stream events
- **THEN** each persisted row includes the session's `conversation_id`
- **AND** replay by `conversation_id` can return those rows even when `task_id` is null

### Requirement: Historical stream events are repaired by execution first, task second
When historical `stream_events` rows are missing `conversation_id`, the system SHALL repair them by resolving `execution_id -> executions.conversation_id` first and `task_id -> tasks.conversation_id` second. Rows that remain unrecoverable after both passes MAY be pruned.

#### Scenario: Chat-session rows repaired through executions
- **WHEN** a historical stream-event row belongs to a standalone chat session and lacks `conversation_id`
- **THEN** the repair process resolves the row using `executions.conversation_id`

#### Scenario: Task-backed rows repaired through tasks when execution conversation is absent
- **WHEN** a historical stream-event row belongs to a task and its execution row lacks `conversation_id`
- **THEN** the repair process falls back to the task's `conversation_id`

#### Scenario: Unrecoverable rows may be removed
- **WHEN** a historical stream-event row has no recoverable conversation through either execution or task linkage
- **THEN** the cleanup process may delete that row rather than keep unusable replay state

### Requirement: Task executions persist conversation identity
All new execution rows SHALL persist `conversation_id` for the conversation they belong to, including task-backed executions and standalone session executions.

#### Scenario: Task transition execution stores conversation_id
- **WHEN** a task transition creates an execution row
- **THEN** the inserted execution row includes that task's `conversation_id`

#### Scenario: Task human-turn execution stores conversation_id
- **WHEN** a task human-turn or retry creates an execution row
- **THEN** the inserted execution row includes that task's `conversation_id`

#### Scenario: Session execution stores conversation_id
- **WHEN** a standalone session creates an execution row
- **THEN** the inserted execution row includes the session conversation's `conversation_id`
