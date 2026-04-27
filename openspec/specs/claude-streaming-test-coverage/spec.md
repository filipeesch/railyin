## Purpose

Defines the test coverage requirements for the Claude engine's incremental streaming behaviour, ensuring that `translateClaudeMessage` stream_event handling and dedup logic are fully exercised by unit and integration tests.

## Requirements

### Requirement: translateClaudeMessage stream_event cases are unit tested
The test suite SHALL contain unit tests for every `stream_event` delta type handled by `translateClaudeMessage`. Each test SHALL call the function directly with a fabricated SDK message and assert the exact `EngineEvent` array returned.

#### Scenario: text_delta produces a token event
- **WHEN** `translateClaudeMessage` receives a `stream_event` message with a `content_block_delta` event containing a `text_delta` with `.text = "hello"`
- **THEN** the function returns `[{ type: "token", content: "hello" }]`

#### Scenario: thinking_delta produces a reasoning event
- **WHEN** `translateClaudeMessage` receives a `stream_event` message with a `content_block_delta` event containing a `thinking_delta` with `.thinking = "let me think"`
- **THEN** the function returns `[{ type: "reasoning", content: "let me think" }]`

#### Scenario: input_json_delta produces no events
- **WHEN** `translateClaudeMessage` receives a `stream_event` message with a `content_block_delta` event containing an `input_json_delta`
- **THEN** the function returns `[]`

#### Scenario: non-delta stream event types produce no events
- **WHEN** `translateClaudeMessage` receives a `stream_event` message whose event type is not `content_block_delta` (e.g. `content_block_start`, `message_delta`)
- **THEN** the function returns `[]`

#### Scenario: unknown delta type produces no events
- **WHEN** `translateClaudeMessage` receives a `stream_event` message with an unrecognized delta type
- **THEN** the function returns `[]`

---

### Requirement: translateClaudeMessage assistant dedup cases are unit tested
The test suite SHALL contain unit tests verifying that `text` and `thinking` content blocks in the `assistant` message produce no `EngineEvent`s after the dedup fix, while `tool_use` blocks continue to produce `tool_start` events.

#### Scenario: assistant with text-only produces no events
- **WHEN** `translateClaudeMessage` receives an `assistant` message containing only a `text` content block
- **THEN** the function returns `[]` (text was already delivered via `stream_event` deltas)

#### Scenario: assistant with thinking-only produces no events
- **WHEN** `translateClaudeMessage` receives an `assistant` message containing only a `thinking` content block
- **THEN** the function returns `[]`

#### Scenario: assistant with tool_use produces tool_start
- **WHEN** `translateClaudeMessage` receives an `assistant` message containing a `tool_use` content block
- **THEN** the function returns `[{ type: "tool_start", ... }]` with the correct name, callId, and args

#### Scenario: assistant with text and tool_use produces only tool_start
- **WHEN** `translateClaudeMessage` receives an `assistant` message containing both a `text` block and a `tool_use` block
- **THEN** the function returns exactly `[{ type: "tool_start", ... }]` — the text block is silently skipped

#### Scenario: existing mixed-content test expectation is updated
- **WHEN** the test `"handles assistant message with text, thinking, and tool_use blocks"` runs after the dedup fix
- **THEN** it asserts `events.map(e => e.type)` equals `["tool_start"]` (previously `["reasoning", "token", "tool_start"]`)

---

### Requirement: CE-1 integration test verifies no double-emit through full pipeline
The test suite SHALL contain an integration test (CE-1, `S-14` in `stream-pipeline-scenarios.test.ts`) that wires a `MockClaudeSdkAdapter` through `ClaudeEngine` and `StreamProcessor` using the `makeRuntime` helper, and verifies that incremental `text_chunk` IPC events are delivered without duplication.

#### Scenario: Incremental text_chunks arrive for each stream_event delta
- **WHEN** `MockClaudeSdkAdapter` yields two `stream_event` text delta messages followed by one assembled `assistant` message
- **THEN** the IPC event log contains exactly two `text_chunk` events — one per delta — and no third `text_chunk` from the `assistant` block

#### Scenario: Final done event arrives after all text_chunks
- **WHEN** the CE-1 scenario completes
- **THEN** IPC contains a `done` event after the `text_chunk` events, in order

#### Scenario: MockClaudeSdkAdapter yields valid SDK message shapes
- **WHEN** `MockClaudeSdkAdapter` is constructed with a pre-canned sequence of SDK messages
- **THEN** it implements the `ClaudeSdkAdapter.run()` interface and yields each message as an `AsyncIterable`
