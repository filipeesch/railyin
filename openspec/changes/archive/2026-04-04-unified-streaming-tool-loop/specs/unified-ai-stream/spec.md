# Unified Streaming Tool Loop — New Capability Spec

## ADDED Requirements

### Requirement: Unified AI stream event protocol
The system SHALL define a `StreamEvent` discriminated union type for all events yielded by `AIProvider.stream()`:

- `{ type: "token"; content: string }` — a text fragment
- `{ type: "tool_calls"; calls: AIToolCall[] }` — all tool calls for this round (fully accumulated)
- `{ type: "done" }` — stream ended, no more events

#### Scenario: Engine handles all three event types
- **WHEN** `stream()` is iterated and yields events of all three types in a single session
- **THEN** the engine forwards `token` events to the UI callback, executes `tool_calls` before continuing the loop, and exits its loop on `done`

#### Scenario: Only one of token or tool_calls appears per round
- **WHEN** the model responds with tool calls in a given round
- **THEN** no `token` events are emitted for that round — the stream only yields `tool_calls` then `done`

#### Scenario: FakeAIProvider scripts all event types
- **WHEN** a test configures `FakeAIProvider` with a scripted sequence of steps
- **THEN** it yields the correct `StreamEvent`s in order for each step (tool_calls step → tool_calls + done; text step → token(s) + done)
