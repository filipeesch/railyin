## MODIFIED Requirements

### Requirement: Conversation supports distinct message types

The system SHALL support the following message types in a conversation: `user`, `assistant`, `system`, `tool_call`, `tool_result`, `transition_event`, `artifact_event`, `ask_user_prompt`. Each message stores its type, content, and creation timestamp.

#### Scenario: Transition creates a transition_event message

- **WHEN** a task is moved from one workflow column to another
- **THEN** a `transition_event` message is appended to the conversation recording the from-state and to-state

#### Scenario: Tool calls and results are recorded

- **WHEN** the AI makes a tool call during execution
- **THEN** a `tool_call` message is appended, and when the result arrives, a `tool_result` message is appended

#### Scenario: ask_user call creates ask_user_prompt message

- **WHEN** the AI calls the `ask_user` tool
- **THEN** an `ask_user_prompt` message is appended with JSON content containing `question`, `selection_mode`, and `options`

## ADDED Requirements

### Requirement: ask_user_prompt message type carries structured question data

The system SHALL store `ask_user_prompt` messages with JSON content conforming to `{ question: string, selection_mode: "single" | "multi", options: string[] }`. This content drives the interactive widget rendered in the chat pane.

#### Scenario: ask_user_prompt content is valid JSON

- **WHEN** an `ask_user_prompt` message is retrieved from the database
- **THEN** its `content` field parses as JSON with `question`, `selection_mode`, and `options` fields

#### Scenario: ask_user_prompt content survives reload

- **WHEN** the drawer is closed and reopened while the task is in `waiting_user` state
- **THEN** the `ask_user_prompt` message is loaded from DB and the widget renders correctly from persisted content
