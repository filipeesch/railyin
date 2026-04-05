## ADDED Requirements

### Requirement: AnthropicProvider communicates using native Anthropic Messages API
The system SHALL implement an `AnthropicProvider` class that sends requests to `POST https://api.anthropic.com/v1/messages` using Anthropic's wire format. The provider SHALL set `x-api-key` and `anthropic-version: 2023-06-01` headers. It SHALL NOT use `Authorization: Bearer`.

#### Scenario: Request sent to Anthropic messages endpoint
- **WHEN** a task is executed with a model resolved to the `anthropic` provider
- **THEN** the HTTP request goes to `https://api.anthropic.com/v1/messages` with `x-api-key` header

#### Scenario: Request sent without Authorization header
- **WHEN** `AnthropicProvider` constructs a request
- **THEN** no `Authorization` header is present in the request

### Requirement: AnthropicProvider extracts system messages from message array
The system SHALL extract all messages with `role: "system"` from the `AIMessage[]` array and concatenate them into the top-level `system` field of the Anthropic request body. System messages SHALL NOT appear in the `messages` array sent to Anthropic.

#### Scenario: System messages moved to top-level system field
- **WHEN** the assembled message array contains two system messages
- **THEN** the Anthropic request body has `system: "<msg1>\n\n<msg2>"` and those messages are absent from `messages[]`

#### Scenario: No system messages results in absent system field
- **WHEN** the assembled message array has no system messages
- **THEN** the Anthropic request body has no `system` field

### Requirement: AnthropicProvider maps tool result messages to Anthropic format
The system SHALL re-map internal `role: "tool"` messages to `role: "user"` messages with `content: [{type: "tool_result", tool_use_id: "...", content: "..."}]` as required by the Anthropic API.

#### Scenario: Tool result mapped to user message with tool_result content block
- **WHEN** the internal message array contains a `role: "tool"` message with `tool_call_id` and `content`
- **THEN** the sent message has `role: "user"` and `content: [{type: "tool_result", tool_use_id: "<tool_call_id>", content: "<content>"}]`

### Requirement: AnthropicProvider maps tool definitions to Anthropic tool format
The system SHALL convert `AIToolDefinition[]` to Anthropic's `tools` format, where each tool uses `input_schema` instead of `parameters`.

#### Scenario: Tool definition converted to Anthropic format
- **WHEN** tools are passed via `AICallOptions.tools`
- **THEN** the Anthropic request body has `tools: [{name, description, input_schema: {type, properties, required}}]`

### Requirement: AnthropicProvider streams tokens and tool calls from Anthropic SSE format
The system SHALL parse Anthropic's SSE streaming events and yield typed `StreamEvent` objects compatible with the existing `AIProvider` interface. Specifically:
- `content_block_delta` with `type: text_delta` → `{ type: "token", content }`
- `content_block_delta` with `type: thinking_delta` → `{ type: "reasoning", content }`
- `content_block_start` with `type: tool_use` + `input_json_delta` events → accumulated into `{ type: "tool_calls", calls }` on `message_stop`
- `message_stop` → `{ type: "done" }`

#### Scenario: Text tokens yielded incrementally
- **WHEN** Anthropic streams `content_block_delta` events with `text_delta`
- **THEN** `AnthropicProvider.stream()` yields a `{ type: "token" }` event for each delta

#### Scenario: Extended thinking tokens yielded as reasoning events
- **WHEN** Anthropic streams `content_block_delta` events with `thinking_delta`
- **THEN** `AnthropicProvider.stream()` yields `{ type: "reasoning" }` events, which are displayed by the existing `ReasoningBubble` component

#### Scenario: Tool calls accumulated and yielded together on completion
- **WHEN** Anthropic streams `content_block_start` with `type: tool_use` and subsequent `input_json_delta` events
- **THEN** `AnthropicProvider.stream()` accumulates all deltas and yields a single `{ type: "tool_calls", calls }` event when the message completes

### Requirement: AnthropicProvider non-streaming turn maps Anthropic response format
The system SHALL implement `turn()` for non-streaming calls to Anthropic, mapping `content[].type === "tool_use"` blocks to `AIToolCall[]` and `content[].type === "text"` blocks to the text result.

#### Scenario: Tool use response mapped to tool calls
- **WHEN** the non-streaming Anthropic response contains a `tool_use` content block
- **THEN** `turn()` returns `{ type: "tool_calls", calls: [...] }`

#### Scenario: Text response mapped to text result
- **WHEN** the non-streaming Anthropic response contains only `text` content blocks
- **THEN** `turn()` returns `{ type: "text", content: "<text>" }`

### Requirement: AnthropicProvider fetches available models from Anthropic models endpoint
The system SHALL fetch `GET https://api.anthropic.com/v1/models` with the `x-api-key` header and return a list of available models with their context window sizes.

#### Scenario: Models returned with context window
- **WHEN** the Anthropic `/v1/models` endpoint responds successfully
- **THEN** the provider returns `[{ id: "anthropic/<model-id>", contextWindow: <context_window> }]`
