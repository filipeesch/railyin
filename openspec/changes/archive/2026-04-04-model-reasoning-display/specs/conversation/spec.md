## MODIFIED Requirements

### Requirement: Conversation supports distinct message types
The system SHALL support the following message types in a conversation: `user`, `assistant`, `system`, `tool_call`, `tool_result`, `transition_event`, `artifact_event`, `ask_user_prompt`, `reasoning`. Each message stores its type, content, and creation timestamp.

#### Scenario: Transition creates a transition_event message
- **WHEN** a task is moved from one workflow column to another
- **THEN** a `transition_event` message is appended to the conversation recording the from-state and to-state

#### Scenario: Tool calls and results are recorded
- **WHEN** the AI makes a tool call during execution
- **THEN** a `tool_call` message is appended, and when the result arrives, a `tool_result` message is appended

#### Scenario: ask_user call creates ask_user_prompt message
- **WHEN** the AI calls the `ask_user` tool
- **THEN** an `ask_user_prompt` message is appended with JSON content containing `question`, `selection_mode`, and `options`

#### Scenario: Reasoning round creates a reasoning message
- **WHEN** the AI engine receives `reasoning` stream events in a round and that round ends
- **THEN** a single `reasoning` message is appended containing the full accumulated reasoning text for that round
