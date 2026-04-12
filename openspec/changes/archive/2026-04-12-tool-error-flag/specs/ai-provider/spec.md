## MODIFIED Requirements

### Requirement: Tool result messages carry error signal for Anthropic provider
The system SHALL include `is_error: true` on Anthropic `tool_result` content blocks when the tool invocation returned an error. This enriches the model's understanding of tool failure states.

#### Scenario: Failed tool result has is_error flag in Anthropic wire format
- **WHEN** `executeTool()` returns a string beginning with `"Error:"` and the active provider is Anthropic
- **THEN** the `tool_result` content block in the next API request includes `is_error: true` alongside the error content string

#### Scenario: Successful tool result has no is_error flag
- **WHEN** `executeTool()` returns a success string (e.g. starting with `"OK:"` or file content) or a `WriteResult`
- **THEN** the `tool_result` content block has no `is_error` field (defaults to false per Anthropic API spec)

#### Scenario: OpenAI-compatible tool result is unaffected
- **WHEN** a tool fails and the active provider is OpenAI-compatible
- **THEN** the tool result message is sent as a plain content string with no `is_error` field (OpenAI API has no equivalent)

### Requirement: Internal AIMessage supports error flag for tool results
The `AIMessage` type SHALL include an optional `isError?: boolean` field. The engine SHALL set this field when pushing a failed tool result to `liveMessages`. Provider `adaptMessages()` implementations use the field to apply provider-specific error signalling.

#### Scenario: Engine sets isError on liveMessages for error results
- **WHEN** the engine receives an error string from `executeTool()` and pushes the tool result to `liveMessages`
- **THEN** the pushed `AIMessage` has `role: "tool"` and `isError: true`
