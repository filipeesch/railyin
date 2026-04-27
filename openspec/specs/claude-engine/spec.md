## Purpose

The Claude engine integrates with the Claude Agent SDK to execute AI turns, translate SDK messages into typed EngineEvents, and stream incremental output to the orchestrator.

## Requirements

### Requirement: ClaudeEngine exposes common tools with full parameter schemas
The system SHALL translate JSON Schema parameter definitions into Zod shapes when registering MCP tools via the Claude Agent SDK. The translation SHALL support scalar types (`string`, `number`, `boolean`), enum-constrained strings, nested `array` types (with recursively translated item schemas), and nested `object` types (with recursively translated property shapes). Parameters whose JSON Schema type is unrecognized SHALL fall back to `z.any()`. The resulting Zod shapes SHALL produce complete, typed MCP `inputSchema` entries in the `tools/list` response seen by Claude Code.

#### Scenario: String enum parameter is translated to typed enum schema

- **WHEN** a common tool has a parameter defined as `{ type: "string", enum: ["a","b","c"] }`
- **THEN** the MCP tools/list entry for that parameter contains `{ "type": "string", "enum": ["a","b","c"] }`

#### Scenario: Array parameter is translated to typed array schema

- **WHEN** a common tool has a parameter defined as `{ type: "array", items: { type: "object", properties: {...} } }`
- **THEN** the MCP tools/list entry for that parameter contains `{ "type": "array", "items": { "type": "object", "properties": {...} } }`

#### Scenario: Object parameter is translated to typed object schema

- **WHEN** a common tool has a parameter defined as `{ type: "object", properties: { name: { type: "string" } } }`
- **THEN** the MCP tools/list entry for that parameter contains `{ "type": "object", "properties": { "name": { "type": "string" } } }`

#### Scenario: interview_me questions array is fully typed in MCP listing

- **WHEN** the Claude engine registers the `interview_me` tool
- **THEN** the MCP tools/list entry for `questions` includes `type: "array"` with an `items` object that contains the `type` enum field with values `exclusive`, `non_exclusive`, `freetext`

#### Scenario: Unknown type falls back to z.any()

- **WHEN** a tool parameter has a JSON Schema type that is not `string`, `number`, `boolean`, `array`, or `object`
- **THEN** the parameter is translated to `z.any()` (producing an empty schema entry), rather than throwing an error

### Requirement: ClaudeEngine delivers text incrementally via stream_event messages
The system SHALL pass `includePartialMessages: true` to `sdk.query()` so the Claude Agent SDK emits `{ type: "stream_event" }` messages during generation. The `translateClaudeMessage` function SHALL handle `stream_event` messages by extracting `text_delta` and `thinking_delta` deltas and mapping them to `{ type: "token" }` and `{ type: "reasoning" }` engine events respectively. The `assistant` message handler SHALL skip `text` and `thinking` content blocks (already delivered as deltas) and SHALL continue to process `tool_use` blocks.

#### Scenario: stream_event with text_delta produces a token event
- **WHEN** `translateClaudeMessage` receives `{ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } }`
- **THEN** it returns `[{ type: "token", content: "Hello" }]`

#### Scenario: stream_event with thinking_delta produces a reasoning event
- **WHEN** `translateClaudeMessage` receives `{ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me think" } } }`
- **THEN** it returns `[{ type: "reasoning", content: "Let me think" }]`

#### Scenario: stream_event with input_json_delta produces no event
- **WHEN** `translateClaudeMessage` receives a `stream_event` with `delta.type === "input_json_delta"`
- **THEN** it returns `[]`

#### Scenario: assistant message with text block produces no token event
- **WHEN** `translateClaudeMessage` receives an `assistant` message whose content contains only a `text` block
- **THEN** it returns `[]` (no token events — already delivered via stream_events)

#### Scenario: assistant message with tool_use block still produces tool_start event
- **WHEN** `translateClaudeMessage` receives an `assistant` message whose content contains a `tool_use` block
- **THEN** it returns a `[{ type: "tool_start", ... }]` event with the correct callId, name, and arguments

### Requirement: translateClaudeMessage handles mixed assistant content correctly
The system SHALL emit only `tool_start` events when `translateClaudeMessage` processes an `assistant` message containing `text`, `thinking`, and `tool_use` blocks together. Text and thinking blocks SHALL be silently skipped (dedup) because they were already delivered via `stream_event` deltas. Only `tool_use` blocks SHALL produce events.

#### Scenario: Mixed assistant message emits only tool_start
- **WHEN** `translateClaudeMessage` processes an `assistant` message with `thinking`, `text`, and `tool_use` content blocks
- **THEN** the function returns exactly `[{ type: "tool_start", ... }]` — not `["reasoning", "token", "tool_start"]`
