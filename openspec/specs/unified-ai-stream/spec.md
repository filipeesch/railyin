## Purpose
Defines the typed `StreamEvent` protocol that `AIProvider.stream()` yields. This shared protocol decouples provider implementations from the engine's tool loop and ensures all events — text tokens, structured tool calls, and stream termination — are handled uniformly.

## Requirements

### Requirement: Unified AI stream event protocol
The system SHALL define a `StreamEvent` discriminated union type for all events yielded by `AIProvider.stream()`:

- `{ type: "token"; content: string }` — a text fragment
- `{ type: "reasoning"; content: string }` — a reasoning/thinking token (from `delta.reasoning_content`)
- `{ type: "tool_calls"; calls: AIToolCall[] }` — all tool calls for this round (fully accumulated)
- `{ type: "done" }` — stream ended, no more events

Providers that do not support reasoning (e.g. `FakeAIProvider`) SHALL never emit `reasoning` events. The engine SHALL handle all four event types.

#### Scenario: Engine handles all four event types
- **WHEN** `stream()` is iterated and yields events of all four types in a single session
- **THEN** the engine forwards `token` events to the UI callback, accumulates `reasoning` events internally, executes `tool_calls` before continuing the loop, and exits its loop on `done`

#### Scenario: Only one of token or tool_calls appears per round
- **WHEN** the model responds with tool calls in a given round
- **THEN** no `token` events are emitted for that round — the stream only yields `reasoning` (optional), `tool_calls`, then `done`

#### Scenario: FakeAIProvider scripts all event types
- **WHEN** a test configures `FakeAIProvider` with a scripted sequence of steps
- **THEN** it yields the correct `StreamEvent`s in order for each step (tool_calls step → tool_calls + done; text step → token(s) + done); `FakeAIProvider` never emits `reasoning` events

#### Scenario: OpenAI-compatible provider yields reasoning events
- **WHEN** the SSE stream contains `delta.reasoning_content` chunks
- **THEN** the provider yields `{ type: "reasoning"; content }` events for each chunk

### Requirement: Orchestrator associates tool calls with preceding reasoning context
The orchestrator's `consumeStream()` SHALL track a `reasoningBlockId` when reasoning is flushed due to a `tool_start` event. Subsequent `tool_call` StreamEvents emitted in the same reasoning-to-text phase SHALL have their `parentBlockId` set to the reasoning block's ID, so the UI can render tool calls as children of the reasoning bubble. The `reasoningBlockId` SHALL be cleared when `token` events arrive (indicating the reasoning phase ended and assistant text is beginning).

#### Scenario: Tool calls after reasoning are grouped under the reasoning block
- **WHEN** the orchestrator receives reasoning events followed by tool_start events before any token events
- **THEN** the tool_call StreamEvents have `parentBlockId` set to the ID of the persisted reasoning block

#### Scenario: Tool calls after text tokens are not grouped under reasoning
- **WHEN** the orchestrator receives token events followed by tool_start events (no preceding reasoning phase)
- **THEN** the tool_call StreamEvents have `parentBlockId = null` (root level)

#### Scenario: Reasoning block ID clears when text tokens arrive
- **WHEN** the orchestrator emits a reasoning block, then tool calls, then receives token events
- **THEN** tool calls emitted after the token events do not reference the earlier reasoning block
