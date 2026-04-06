## MODIFIED Requirements

### Requirement: spawn_agent tool call is intercepted before the standard executeTool path
The system SHALL intercept `spawn_agent` tool calls in the engine's tool-call loop, before forwarding to `executeTool`. This mirrors how `ask_me` is intercepted but does NOT suspend execution. Before executing children, the engine SHALL append a `tool_call` message to `conversation_messages` and push it to `liveMessages`, matching the recording pattern used by all other tools.

#### Scenario: Interception happens transparently
- **WHEN** the model issues a `spawn_agent` tool call
- **THEN** the engine runs children, injects a `tool_result` message with the results array, and continues the loop without returning control to the model for a streaming response yet

#### Scenario: tool_call message is recorded before child execution
- **WHEN** the model issues a `spawn_agent` tool call
- **THEN** the engine appends a `tool_call` message to `conversation_messages` with the call details (name, arguments) before executing any children, and pushes the corresponding assistant message with `tool_calls` to `liveMessages`
