## Purpose
The Anthropic provider translates the engine's internal `AIMessage[]` format to the native Anthropic Messages API, handles SSE streaming of text, reasoning, and tool use, and exposes model discovery.

## Requirements

### Requirement: Anthropic provider sends requests to the native Messages API
The system SHALL implement `AnthropicProvider` that sends requests to `POST https://api.anthropic.com/v1/messages` with:
- `x-api-key: <api_key>` header
- `anthropic-version: 2023-06-01` header
- Request body in Anthropic Messages format (not OpenAI format)

#### Scenario: Valid request sent with correct headers
- **WHEN** the engine calls `provider.stream(messages, options)` on an `AnthropicProvider` instance
- **THEN** the HTTP request is sent to `https://api.anthropic.com/v1/messages` with `x-api-key` and `anthropic-version` headers present and no `Authorization` header

### Requirement: Anthropic provider extracts system messages to the top-level system field
The system SHALL extract all `AIMessage` entries with `role: "system"` and concatenate their content into the top-level `system` field of the Anthropic request body. These messages SHALL NOT appear in the `messages` array sent to the API.

#### Scenario: System message extracted from messages array
- **WHEN** `messages` contains one or more entries with `role: "system"`
- **THEN** the Anthropic request body has a `system` field with the concatenated content and the `messages` array contains only non-system messages

### Requirement: Anthropic provider maps OpenAI tool result format to Anthropic format
The system SHALL convert `AIMessage` entries with `role: "tool"` into Anthropic's `role: "user"` messages with a single `tool_result` content block, mapping `tool_call_id` → `tool_use_id` and preserving `content`.

#### Scenario: Tool result message converted
- **WHEN** `messages` contains `{ role: "tool", tool_call_id: "abc", content: "result" }`
- **THEN** the Anthropic request body contains `{ role: "user", content: [{ type: "tool_result", tool_use_id: "abc", content: "result" }] }`

### Requirement: Anthropic provider maps tool definitions to Anthropic format
The system SHALL convert `tools` (OpenAI format with `function.parameters`) to Anthropic format where each tool has `name`, `description`, and `input_schema` (not `parameters`).

#### Scenario: Tool definition schema remapped
- **WHEN** the engine passes a tool definition with `function.name`, `function.description`, and `function.parameters`
- **THEN** the Anthropic request body tool has `name`, `description`, and `input_schema` matching the source `parameters`

### Requirement: Anthropic provider handles SSE streaming for text, reasoning, and tool use
The system SHALL process the Anthropic SSE event stream and emit events matching the engine's `AIStreamEvent` interface:
- `content_block_delta` with `delta.type: "text_delta"` → token event
- `content_block_delta` with `delta.type: "thinking_delta"` → reasoning event
- `content_block_start` + `content_block_delta` with `delta.type: "input_json_delta"` → accumulated tool call

#### Scenario: Text delta events emitted as tokens
- **WHEN** the SSE stream emits `content_block_delta` with `delta.type: "text_delta"`
- **THEN** the provider emits a token event with the delta text

#### Scenario: Thinking delta events emitted as reasoning
- **WHEN** the SSE stream emits `content_block_delta` with `delta.type: "thinking_delta"`
- **THEN** the provider emits a reasoning event with the thinking text

#### Scenario: Tool use accumulated and emitted on block stop
- **WHEN** the SSE stream emits a `content_block_start` with `type: "tool_use"` followed by `input_json_delta` events
- **THEN** the provider accumulates the JSON fragments and emits a tool call event with complete tool name and input JSON after `content_block_stop`

### Requirement: Anthropic provider supports non-streaming turn execution
The system SHALL implement a non-streaming `turn()` method that sends a non-streaming Anthropic request and maps the response content blocks to the engine's `AITurnResult` format.

#### Scenario: Non-streaming response mapped to turn result
- **WHEN** `provider.turn(messages, options)` is called
- **THEN** the provider sends a POST request without `stream: true`, maps `content` blocks to text and tool calls, and returns a complete `AITurnResult`

### Requirement: Anthropic provider fetches model list from the Anthropic API
The system SHALL implement `provider.listModels()` by calling `GET https://api.anthropic.com/v1/models` with the `x-api-key` and `anthropic-version` headers. The response SHALL be mapped to `ModelInfo[]` with `id` and `contextWindow: null` (Anthropic does not expose context window via this API).

#### Scenario: Model list fetched and returned
- **WHEN** `provider.listModels()` is called and the API responds with a valid list
- **THEN** the provider returns an array of `{ id: string, contextWindow: null }` objects

#### Scenario: Empty array returned on API failure
- **WHEN** the `/v1/models` request returns an error or non-JSON response
- **THEN** `listModels()` returns an empty array without throwing

### Requirement: Anthropic provider supports configurable cache TTL
The system SHALL support an optional `ttl` field in `cache_control` blocks sent to the Anthropic API. When the workspace config sets `anthropic.cache_ttl` to `"1h"`, all `cache_control` blocks SHALL include `ttl: "1h"`. When set to `"5m"` or omitted, no `ttl` field is included (Anthropic defaults to 5 minutes).

#### Scenario: Default 5-minute TTL (no config or explicit "5m")
- **WHEN** `anthropic.cache_ttl` is absent or `"5m"` in workspace config
- **THEN** `cache_control` blocks are `{ type: "ephemeral" }` with no `ttl` field

#### Scenario: Extended 1-hour TTL
- **WHEN** `anthropic.cache_ttl` is `"1h"` in workspace config
- **THEN** `cache_control` blocks are `{ type: "ephemeral", ttl: "1h" }`

#### Scenario: Non-Anthropic providers unaffected
- **WHEN** the active provider is not Anthropic
- **THEN** no `cache_control` field is included in any request body

### Requirement: stream() uses configured effort as default for parent agent calls
The system SHALL apply `anthropic.effort` from workspace config to `stream()` calls when no explicit `effort` is provided in `AICallOptions`. When `AICallOptions.effort` is explicitly set (e.g. sub-agents passing `"low"`), it SHALL take precedence over the config value.

#### Scenario: Config effort applied when no explicit effort given
- **WHEN** `anthropic.effort` is `"medium"` in workspace config AND `stream()` is called without an `effort` field in `AICallOptions`
- **THEN** the Anthropic request body includes `output_config: { effort: "medium" }`

#### Scenario: Explicit AICallOptions effort overrides config
- **WHEN** `anthropic.effort` is `"medium"` in workspace config AND `stream()` is called with `effort: "low"` in `AICallOptions`
- **THEN** the Anthropic request body includes `output_config: { effort: "low" }`

#### Scenario: No effort in config and no explicit effort — omit output_config
- **WHEN** `anthropic.effort` is absent from workspace config AND `stream()` is called without `effort` in `AICallOptions`
- **THEN** the Anthropic request body does NOT include an `output_config` field
