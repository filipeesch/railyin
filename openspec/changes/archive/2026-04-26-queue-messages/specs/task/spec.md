## MODIFIED Requirements

### Requirement: Task input is enabled during active execution for queuing
The task conversation input editor SHALL remain enabled while `executionState === "running"`. The queue button SHALL be shown alongside the stop button. Queued messages SHALL be stored in the task store keyed by task ID and drained when the task's stream emits a `done` event AND `executionState` is not `failed` or `cancelled`. This modifies the prior behavior where the editor was disabled during `running` state.

#### Scenario: Editor is enabled while task is running
- **WHEN** a task's `executionState` is `"running"`
- **THEN** the conversation input editor accepts text input

#### Scenario: Task queue drains on completion
- **WHEN** the task stream emits a `done` event and `executionState` transitions to `completed` or `idle` and queue is non-empty
- **THEN** all queued messages are sent as a single batched message

#### Scenario: Task queue does NOT drain on failure or cancellation
- **WHEN** `executionState` transitions to `failed` or `cancelled`
- **THEN** no automatic send occurs for queued items; they remain in the queue

#### Scenario: Task queue is isolated per task
- **WHEN** messages are queued for task A while it is running
- **THEN** task B's queue remains empty
