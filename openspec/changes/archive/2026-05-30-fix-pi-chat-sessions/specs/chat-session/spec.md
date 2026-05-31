## ADDED Requirements

### Requirement: Pi engine chat sessions require context window configuration
When the selected model uses the Pi engine, the system SHALL resolve `contextWindowOverride` from Model Settings before starting the chat execution. If no context window is configured for the selected model, the system SHALL persist a system error message in the conversation and halt execution without creating a managed AI execution.

#### Scenario: Pi model with context window configured produces a response
- **WHEN** the user sends a message in a chat session with a Pi model that has a context window configured
- **THEN** the system resolves the context window, starts the execution, and produces an AI response

#### Scenario: Pi model without context window configured shows error
- **WHEN** the user sends a message in a chat session with a Pi model that has no context window configured in Model Settings
- **THEN** the system persists a system error message in the conversation (e.g. "Pi requires a context window configured for model '…'. Go to Model Settings to configure it.") and the session returns to idle without calling the Pi engine

### Requirement: Board tools available in chat sessions
The system SHALL make board management tools (`get_task`, `list_tasks`, `create_task`, `move_task`, `message_task`, `edit_task`, `delete_task`, `get_board_summary`) available to the AI in chat sessions, consistent with task execution contexts.

#### Scenario: Board tools reachable from chat
- **WHEN** the AI in a chat session calls a board tool (e.g. `get_task`)
- **THEN** the tool executes and the result is returned to the AI as a tool result message
