## MODIFIED Requirements

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
