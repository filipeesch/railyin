## ADDED Requirements

### Requirement: message_task delivers a human-turn message to another task's conversation
The system SHALL provide a `message_task` tool that appends a human-authored message to a target task's conversation and triggers that task's AI model. The tool SHALL call `handleHumanTurn` for the target task asynchronously (fire-and-forget). The tool SHALL return immediately with a status of `"delivered"` or `"queued"` without waiting for the triggered execution to complete. The tool SHALL be a member of the `tasks_write` tool group.

#### Scenario: Message delivered to idle task
- **WHEN** an agent calls `message_task` with a valid `task_id` and `message`, and the target task's `execution_state` is `idle` or `waiting_user`
- **THEN** `handleHumanTurn` is called asynchronously for the target task and the tool returns `"delivered"`

#### Scenario: Message queued when target is running
- **WHEN** an agent calls `message_task` with a valid `task_id` and `message`, and the target task's `execution_state` is `running`
- **THEN** the message is inserted into `pending_messages` for that task and the tool returns `"queued"`

#### Scenario: Agent may message itself
- **WHEN** an agent calls `message_task` with its own `task_id`
- **THEN** the message is queued (since the agent is currently running) and returned as `"queued"`; the message is delivered after the current execution ends

#### Scenario: Unknown task_id returns error
- **WHEN** an agent calls `message_task` with a `task_id` that does not exist
- **THEN** the tool returns a descriptive error string and no message is created

### Requirement: Pending messages are stored in a dedicated table
The system SHALL maintain a `pending_messages` table with columns: `id` (integer primary key), `task_id` (integer, foreign key to tasks), `content` (text), and `created_at` (datetime, default current timestamp). Messages are stored in FIFO order.

#### Scenario: Queued message is persisted
- **WHEN** `message_task` queues a message for a running task
- **THEN** a row is inserted into `pending_messages` with the correct `task_id` and `content`

#### Scenario: Delivered message is removed from queue
- **WHEN** a pending message is flushed and handed to `handleHumanTurn`
- **THEN** the corresponding row is deleted from `pending_messages`
