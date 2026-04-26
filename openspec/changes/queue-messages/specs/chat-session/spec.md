## MODIFIED Requirements

### Requirement: Chat session input is enabled during active execution
The chat session input editor SHALL remain enabled while `session.status === "running"`. The queue button SHALL be shown alongside the stop button. Queued messages SHALL be stored in the chat store keyed by session ID and drained when the session's stream emits a `done` event. This modifies the prior behavior where the editor was disabled during `running` status.

#### Scenario: Editor is enabled while session is running
- **WHEN** a chat session's `status` is `"running"`
- **THEN** the conversation input editor accepts text input

#### Scenario: Session queue drains on done event
- **WHEN** the session stream emits a `done` event and the session queue is non-empty
- **THEN** all queued messages are sent as a single batched message

#### Scenario: Session queue is isolated per session
- **WHEN** messages are queued for session A
- **THEN** session B's queue remains empty
