## MODIFIED Requirements

### Requirement: Conversation supports distinct message types
The system SHALL support the following message types in a conversation: `user`, `assistant`, `system`, `tool_call`, `tool_result`, `transition_event`, `file_diff`, `ask_user_prompt`, `reasoning`, `compaction_summary`, `code_review`. Each message stores its type, content, creation timestamp, and any structured metadata needed to render that message type correctly.

For `transition_event`, the structured metadata SHALL remain the canonical source of transition details. When a task enters a column with `on_enter_prompt`, the `transition_event` metadata SHALL include the source and target workflow states plus the instruction detail needed to render the entered-column transition card. New prompted column-entry history SHALL NOT rely on a separate visible `user(role="prompt")` message to explain the automation that ran.

#### Scenario: Transition creates a transition_event message
- **WHEN** a task is moved from one workflow column to another
- **THEN** a `transition_event` message is appended to the conversation recording the from-state and to-state

#### Scenario: Prompted column entry stores transition instruction detail in metadata
- **WHEN** a task enters a column that has an `on_enter_prompt`
- **THEN** the appended `transition_event` metadata includes the instruction detail required to render the entered-column card and its expandable instructions

#### Scenario: New prompted column entry does not require a standalone visible prompt row
- **WHEN** a task enters a column that has an `on_enter_prompt`
- **THEN** the conversation history for that transition remains understandable from the `transition_event` row alone without depending on a neighboring visible `user(role="prompt")` message

#### Scenario: Tool calls and results are recorded for all tools including intercepted tools
- **WHEN** the AI makes a tool call during execution, including intercepted tools like `spawn_agent` and `ask_me`
- **THEN** a `tool_call` message is appended before execution, and when the result arrives, a `tool_result` message is appended

#### Scenario: ask_me call creates ask_user_prompt message
- **WHEN** the AI calls the `ask_me` tool
- **THEN** an `ask_user_prompt` message is appended with JSON content containing the structured `questions` array

#### Scenario: Reasoning round creates a reasoning message
- **WHEN** the AI engine receives `reasoning` stream events in a round and that round ends
- **THEN** a single `reasoning` message is appended containing the full accumulated reasoning text for that round
