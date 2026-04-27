## ADDED Requirements

### Requirement: Claude engine streams text tokens incrementally
The system SHALL enable `includePartialMessages: true` on every `sdk.query()` call so the Claude Agent SDK emits `{ type: "stream_event" }` messages for each `content_block_delta` as it arrives from the Anthropic API. Each `text_delta` delta SHALL be translated to a `{ type: "token" }` EngineEvent immediately, before the turn completes.

#### Scenario: Text appears incrementally during generation
- **WHEN** Claude is generating a response and the Anthropic API sends multiple `text_delta` stream events
- **THEN** each delta is translated to a `{ type: "token", content: <delta text> }` EngineEvent and forwarded to the orchestrator without waiting for the turn to complete

#### Scenario: No text duplication at end of turn
- **WHEN** text deltas have been streamed via `stream_event` messages and the final `assistant` message arrives
- **THEN** the `assistant` message's `text` content blocks are silently skipped — no additional `token` events are emitted for that content

### Requirement: Claude engine streams reasoning tokens incrementally
The system SHALL translate `thinking_delta` stream events (from `stream_event` messages) into `{ type: "reasoning" }` EngineEvents immediately as they arrive. Reasoning content SHALL appear in the UI progressively, not as a single block after the model finishes thinking.

#### Scenario: Reasoning appears incrementally during extended thinking
- **WHEN** Claude is using extended thinking and the Anthropic API sends multiple `thinking_delta` stream events
- **THEN** each delta is translated to a `{ type: "reasoning", content: <delta thinking> }` EngineEvent and forwarded to the orchestrator without waiting for the turn to complete

#### Scenario: No reasoning duplication at end of turn
- **WHEN** reasoning deltas have been streamed via `stream_event` messages and the final `assistant` message arrives
- **THEN** the `assistant` message's `thinking` content blocks are silently skipped — no additional `reasoning` events are emitted for that content

### Requirement: Tool use blocks continue to be processed from assembled assistant message
The system SHALL continue to process `tool_use` content blocks from the final `assistant` message. Tool use information (name, id, input) SHALL NOT be emitted from `stream_event` deltas (`input_json_delta` is not rendered incrementally).

#### Scenario: Tool call events are emitted from assembled message
- **WHEN** Claude calls a tool and the `assistant` message arrives with a `tool_use` content block
- **THEN** a `tool_start` EngineEvent is emitted with the complete tool name, callId, and arguments — unchanged from current behavior

#### Scenario: Non-delta stream events are ignored
- **WHEN** `stream_event` messages with types other than `content_block_delta` arrive (e.g. `content_block_start`, `content_block_stop`, `message_start`, `message_delta`)
- **THEN** no EngineEvents are emitted for those messages
