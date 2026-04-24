## ADDED Requirements

### Requirement: Conversation read APIs use conversationId as the canonical identifier
The system SHALL treat `conversationId` as the primary identifier for conversation reads and stream-event reads across both task and standalone session conversations.

#### Scenario: Messages read by conversationId
- **WHEN** a caller requests conversation messages with a `conversationId`
- **THEN** the system returns the ordered messages for that conversation regardless of whether it belongs to a task or a standalone session

#### Scenario: Stream events read by conversationId
- **WHEN** a caller requests persisted stream events with a `conversationId`
- **THEN** the system returns the events for that conversation regardless of whether it belongs to a task or a standalone session

### Requirement: Legacy taskId callers remain compatible during migration
The system SHALL preserve compatibility for task-backed conversation reads during migration by accepting task-based identifiers where required and resolving them to the canonical conversation ID internally.

#### Scenario: Task-backed caller uses compatibility alias
- **WHEN** an existing task-backed caller requests messages or stream events using `taskId`
- **THEN** the system resolves the corresponding `conversationId` internally and returns the canonical conversation data

#### Scenario: Session callers do not require task identity
- **WHEN** a standalone session caller requests messages or stream events
- **THEN** the system uses the session's `conversationId` directly and does not require a task ID

