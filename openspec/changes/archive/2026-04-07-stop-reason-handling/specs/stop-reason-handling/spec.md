## ADDED Requirements

### Requirement: stream() emits a stop_reason event for non-standard stop reasons
The system SHALL emit a `{ type: "stop_reason"; reason: string }` StreamEvent when the Anthropic API returns a `stop_reason` that is not `end_turn`, `tool_use`, or `max_tokens`. This event SHALL be emitted before the `done` event.

#### Scenario: refusal stop reason is forwarded as a StreamEvent
- **WHEN** the Anthropic streaming API sends a `message_delta` event with `delta.stop_reason === "refusal"`
- **THEN** `stream()` yields `{ type: "stop_reason", reason: "refusal" }` followed by `{ type: "done" }`

#### Scenario: context window exceeded stop reason is forwarded as a StreamEvent
- **WHEN** the Anthropic streaming API sends a `message_delta` event with `delta.stop_reason === "model_context_window_exceeded"`
- **THEN** `stream()` yields `{ type: "stop_reason", reason: "model_context_window_exceeded" }` followed by `{ type: "done" }`

#### Scenario: standard stop reasons do not emit a stop_reason event
- **WHEN** the Anthropic streaming API returns `stop_reason` of `end_turn`, `tool_use`, or `max_tokens`
- **THEN** `stream()` does NOT yield a `stop_reason` StreamEvent

### Requirement: turn() includes stop_reason in its text result
The system SHALL include an optional `stopReason` field on the `{ type: "text" }` variant of `AITurnResult` when the Anthropic API returns a non-standard stop reason.

#### Scenario: refusal stop reason is included in AITurnResult
- **WHEN** the non-streaming Anthropic API returns `stop_reason: "refusal"`
- **THEN** `turn()` returns `{ type: "text", content: "", stopReason: "refusal" }`

#### Scenario: standard stop reason does not set stopReason field
- **WHEN** the non-streaming Anthropic API returns `stop_reason: "end_turn"`
- **THEN** `turn()` returns `{ type: "text", content: "..." }` with no `stopReason` field

### Requirement: Engine terminates execution on refusal stop reason
The system SHALL end the current execution with an error when it receives a `stop_reason: "refusal"` event from the stream, rather than nudging.

#### Scenario: refusal triggers execution failure
- **WHEN** the model stream emits `{ type: "stop_reason", reason: "refusal" }` during an execution round
- **THEN** the engine logs a warn, appends a system message noting the refusal, and terminates the execution with an error (not a nudge)

### Requirement: Engine triggers compaction on context window exceeded stop reason
The system SHALL trigger immediate compaction when it receives a `stop_reason: "model_context_window_exceeded"` event, rather than nudging.

#### Scenario: context_window_exceeded triggers compaction
- **WHEN** the model stream emits `{ type: "stop_reason", reason: "model_context_window_exceeded" }` during an execution round
- **THEN** the engine triggers `compactConversation()` and retries the round rather than nudging

#### Scenario: unknown stop reasons are logged as warnings
- **WHEN** the model stream emits `{ type: "stop_reason", reason: "<unknown>" }` for any unrecognized stop reason
- **THEN** the engine logs a `warn` with the stop reason value and continues normally
