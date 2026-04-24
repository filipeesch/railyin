## REMOVED Requirements

### Requirement: Legacy stream.token wire format
**Reason**: The `stream.token` broadcast path is dead code. Both `stream.token` and `stream.event` were emitted simultaneously by the backend. The frontend fallback (`LegacyStreamState`) only activated when no `ConversationStreamState` existed for a conversation — a condition that was unreachable in normal operation since `stream.event` always arrived first. All live delivery is now exclusively via `stream.event`.
**Migration**: No client-side migration needed. The `stream.event` path is fully established and handles all cases including text chunks, reasoning chunks, status messages, and stream termination. Any custom integrations listening to `stream.token` WebSocket messages must migrate to `stream.event`.

## MODIFIED Requirements

### Requirement: Unified AI stream event protocol
The system SHALL define a `StreamEvent` discriminated union type for all events yielded by `AIProvider.stream()`:

- `{ type: "token"; content: string }` — a text fragment
- `{ type: "reasoning"; content: string }` — a reasoning/thinking token (from `delta.reasoning_content`)
- `{ type: "tool_calls"; calls: AIToolCall[] }` — all tool calls for this round (fully accumulated)
- `{ type: "done" }` — stream ended, no more events

Providers that do not support reasoning (e.g. `FakeAIProvider`) SHALL never emit `reasoning` events. The engine SHALL handle all four event types.

The system SHALL deliver live streaming updates to connected clients exclusively via the `stream.event` WebSocket message type (`{ type: "stream.event"; payload: StreamEvent }`). The `stream.token` wire format is removed and SHALL NOT be emitted by the backend or handled by the frontend.

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

#### Scenario: No legacy stream.token message is sent during streaming
- **WHEN** the AI produces tokens during an execution
- **THEN** the WebSocket broadcast contains only `stream.event` messages — no `stream.token` messages are sent
