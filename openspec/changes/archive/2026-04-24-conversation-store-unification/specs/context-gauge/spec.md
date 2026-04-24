## ADDED Requirements

### Requirement: Context usage is available by conversationId
The system SHALL expose conversation-scoped context usage retrieval keyed by `conversationId` so both task and session chat can read the same kind of usage estimate.

#### Scenario: Task chat requests context usage by conversation
- **WHEN** the active task chat requests context usage for its conversation
- **THEN** the system returns context usage for that conversation without requiring task-scoped estimation APIs

#### Scenario: Session chat requests context usage by conversation
- **WHEN** the active standalone session requests context usage for its conversation
- **THEN** the system returns context usage for that conversation using the same response shape as task chat

