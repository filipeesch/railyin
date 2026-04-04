## Purpose
Model reasoning captures the internal thinking tokens produced by reasoning-capable models (e.g. Qwen3, DeepSeek-R1). Reasoning is surfaced to the user as collapsible bubbles in the conversation timeline and persisted to the database for later review, but is never injected back into the model's context window.

## Requirements

### Requirement: Reasoning tokens are surfaced as a collapsible bubble per model round
The system SHALL render a `ReasoningBubble` component for each `reasoning` conversation message. While the reasoning is streaming, the bubble SHALL be expanded with a pulsing "Thinking…" header animation. When the round ends, the bubble SHALL auto-collapse and the header SHALL change to "Thought for Xs" with a checkmark icon, where X is the elapsed time in seconds. Each model round that produces reasoning gets its own independent bubble.

#### Scenario: Bubble expands and animates during streaming
- **WHEN** the engine begins forwarding reasoning tokens for a new round
- **THEN** a new `ReasoningBubble` appears in the conversation timeline, expanded, with a pulsing header showing "Thinking…"

#### Scenario: Bubble auto-collapses when round ends
- **WHEN** the engine emits tool calls or a final text response, ending the reasoning phase
- **THEN** the active `ReasoningBubble` header updates to "Thought for Xs ✓" and the body collapses

#### Scenario: Bubble body is scrollable
- **WHEN** the user expands a `ReasoningBubble` whose content exceeds the visible area
- **THEN** the body scrolls vertically with a visible scrollbar, and the bubble does not expand the page beyond a fixed max height

#### Scenario: Multiple reasoning bubbles per execution
- **WHEN** the model reasons before tool calls in round 1 and again before the final response in round 3
- **THEN** two independent `ReasoningBubble` components appear at the correct positions in the timeline

#### Scenario: Reasoning bubbles survive page reload in collapsed state
- **WHEN** the user reloads the page and reopens a task drawer for a task with persisted reasoning messages
- **THEN** reasoning bubbles render collapsed showing the recorded text, without a duration (duration is ephemeral)

### Requirement: Reasoning tokens are persisted to the DB as a `reasoning` message type
The system SHALL append a `reasoning` message to the conversation once a reasoning round completes. The message content SHALL be the full accumulated reasoning text for that round. Reasoning messages are appended immediately before the `tool_call` or `assistant` message they preceded.

#### Scenario: Reasoning message saved before tool_call message
- **WHEN** a model round produces reasoning tokens followed by tool calls
- **THEN** a `reasoning` message is inserted before the first `tool_call` message of that round in the timeline

#### Scenario: Reasoning message saved before assistant message
- **WHEN** a model round produces reasoning tokens followed by the final text response (no tool calls)
- **THEN** a `reasoning` message is inserted before the `assistant` message in the timeline

#### Scenario: No reasoning message saved when no reasoning occurred
- **WHEN** the model completes a round with no `delta.reasoning_content` tokens
- **THEN** no `reasoning` message is appended to the conversation

### Requirement: Reasoning is excluded from the LLM context sent on subsequent calls
The system SHALL not include `reasoning` messages in the message array passed to the AI provider. Reasoning content is for the user only and SHALL NOT be injected into the model's context window.

#### Scenario: compactMessages excludes reasoning type
- **WHEN** `compactMessages` processes the conversation history
- **THEN** messages with `type: "reasoning"` are skipped and do not appear in the returned `AIMessage[]`

### Requirement: Reasoning rounds do not consume the empty-response nudge budget
The system SHALL not increment `emptyResponseNudges` for a round where reasoning tokens were received, even if no `delta.content` or tool calls were produced in the same round.

#### Scenario: Nudge not fired when reasoning was seen
- **WHEN** a stream round completes with reasoning tokens but no content tokens and no tool calls
- **THEN** `emptyResponseNudges` is not incremented and no nudge message is appended to `liveMessages`

#### Scenario: Nudge fires when no reasoning and no content
- **WHEN** a stream round completes with no reasoning tokens, no content tokens, and no tool calls
- **THEN** `emptyResponseNudges` is incremented and a nudge user message is appended
