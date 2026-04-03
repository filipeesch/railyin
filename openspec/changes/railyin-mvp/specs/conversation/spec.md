## ADDED Requirements

### Requirement: Conversation is an append-only message timeline
Each task's conversation SHALL be an ordered, append-only sequence of messages. Messages are never deleted or reordered. The conversation serves as the canonical history of everything that happened to the task.

#### Scenario: Messages accumulate across executions
- **WHEN** multiple executions run for the same task
- **THEN** all messages from all executions appear in a single chronological timeline

#### Scenario: Messages cannot be deleted
- **WHEN** a task exists
- **THEN** the system provides no mechanism to delete individual conversation messages

### Requirement: Conversation supports distinct message types
The system SHALL support the following message types in a conversation: `user`, `assistant`, `system`, `tool_call`, `tool_result`, `transition_event`, `artifact_event`. Each message stores its type, content, and creation timestamp.

#### Scenario: Transition creates a transition_event message
- **WHEN** a task is moved from one workflow column to another
- **THEN** a `transition_event` message is appended to the conversation recording the from-state and to-state

#### Scenario: Tool calls and results are recorded
- **WHEN** the AI makes a tool call during execution
- **THEN** a `tool_call` message is appended, and when the result arrives, a `tool_result` message is appended

### Requirement: Full conversation context is provided to AI on each call
The system SHALL include all prior conversation messages for a task as context when making an AI call, in addition to the current `stage_instructions` and the new prompt or user message.

#### Scenario: AI receives full history
- **WHEN** an execution is triggered (on_enter_prompt or human turn)
- **THEN** the AI request includes: system message with stage_instructions, all prior conversation messages, and the new message

#### Scenario: Stage instructions are always prepended
- **WHEN** any AI call is made for a task
- **THEN** the current column's `stage_instructions` are included as a system message regardless of whether it is a prompt-triggered or human-initiated call
