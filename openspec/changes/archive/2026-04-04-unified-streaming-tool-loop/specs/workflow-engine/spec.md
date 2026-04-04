## ADDED Requirements

### Requirement: Unified AI stream drives execution from first token to final response
The system SHALL execute all tool rounds and the final text response using a single streaming loop. There SHALL be no separate second API call to retrieve the final answer after tool calls are resolved.

#### Scenario: Tool loop exits after model produces text
- **WHEN** the model returns a streaming response with `finish_reason: "stop"` and no `delta.tool_calls`
- **THEN** the engine treats that streamed text as the final response and does not issue another API call

#### Scenario: Bad assistant responses never enter history
- **WHEN** the model emits tool-call syntax (XML `<tool_call>`, JSON blobs) as plain text in its response
- **THEN** the unified stream() call yields a `tool_calls` event via the API's structured `delta.tool_calls` field; rogue text is never stored as an assistant message

## MODIFIED Requirements

### Requirement: AI model can invoke tools and receive results within an execution
The system SHALL provide the AI model with tools on every streaming round, including the final round. The engine SHALL NOT switch the model out of tool-aware mode between rounds.

#### Scenario: Model calls tools then produces final answer
- **WHEN** the model calls one or more tools in sequence and then responds with text
- **THEN** each tool call and result is appended to conversation history and the final text is streamed to the UI in a single continuous session

#### Scenario: Tool definitions are present on all rounds
- **WHEN** any round of the execution loop runs, including the round that produces the final text response
- **THEN** the `stream()` request includes the full tool definitions, giving the model the option to call additional tools even in the final round
