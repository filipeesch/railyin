## MODIFIED Requirements

### Requirement: Copilot SDK events are translated to EngineEvent types
The system SHALL translate Copilot SDK streaming events to the `EngineEvent` discriminated union. The Copilot adapter SHALL preserve enough SDK metadata for the conversation layer to render rich user-facing tool activity and suppress non-user-facing internal activity:
- `assistant.message_delta` → `{ type: "token" }`
- `assistant.thinking_delta` → `{ type: "reasoning" }`
- `tool.execution_start` → `{ type: "tool_start" }`
- `tool.execution_complete` → `{ type: "tool_result" }`, including structured `writtenFiles` when the tool changed files
- `tool.execution_partial_result` → `{ type: "status" }` only for non-internal tools, with truncated content
- `tool.execution_progress` → `{ type: "status" }` only for non-internal tools, with truncated content
- `session.complete` → `{ type: "done" }`
- `session.error` → `{ type: "error" }`

The `translateEvent()` function SHALL look up `toolCallId` from `tool.execution_partial_result` and `tool.execution_progress` events in `toolMetaByCallId` and suppress status events for tools marked as internal. For non-internal tools, the status message SHALL be truncated to a single summary line of at most 120 characters, using the last non-empty line of the output and prefixed with the tool name when available.

#### Scenario: Message delta translated to token event
- **WHEN** the SDK emits an `assistant.message_delta` event with content "Hello"
- **THEN** the engine yields `{ type: "token", content: "Hello" }`

#### Scenario: Tool execution events translated to tool events
- **WHEN** the SDK emits `tool.execution_start` for `editFile` then `tool.execution_complete`
- **THEN** the engine yields `{ type: "tool_start", name: "editFile", arguments: ... }` followed by `{ type: "tool_result", name: "editFile", result: ... }`

#### Scenario: Tool result translation preserves rich display content
- **WHEN** the SDK emits a `tool.execution_complete` event containing detailed or structured result content in addition to the concise LLM-facing text
- **THEN** the translated event keeps that richer content available to the conversation/UI layer

#### Scenario: Non-user-facing Copilot activity is not surfaced in the chat timeline
- **WHEN** the SDK identifies a message or tool-related event as hidden, internal, or otherwise non-user-facing through preserved metadata
- **THEN** that activity is not rendered as a visible conversation item

#### Scenario: User-facing tool execution still appears in order
- **WHEN** the SDK emits user-visible tool activity for a Copilot execution
- **THEN** the translated conversation items preserve the execution order needed by the timeline and remain visible in the chat UI

#### Scenario: Internal tool partial results are suppressed
- **WHEN** the SDK emits `tool.execution_partial_result` for a tool whose `toolCallId` maps to an internal tool in `toolMetaByCallId`
- **THEN** `translateEvent()` returns `null` and no status event is emitted

#### Scenario: Internal tool progress events are suppressed
- **WHEN** the SDK emits `tool.execution_progress` for a tool whose `toolCallId` maps to an internal tool in `toolMetaByCallId`
- **THEN** `translateEvent()` returns `null` and no status event is emitted

#### Scenario: Non-internal tool partial result is truncated to a summary line
- **WHEN** the SDK emits `tool.execution_partial_result` with multi-line `partialOutput` for a non-internal tool named `run_in_terminal`
- **THEN** the translated status message contains at most 120 characters, using the last non-empty line of output, prefixed with the tool name

#### Scenario: Session completion translated to done event
- **WHEN** the SDK emits `session.complete`
- **THEN** the engine yields `{ type: "done" }`

#### Scenario: Session error translated to error event
- **WHEN** the SDK emits `session.error` with message "Rate limited"
- **THEN** the engine yields `{ type: "error", message: "Rate limited" }`

#### Scenario: Copilot write tool completion emits structured written files
- **WHEN** a Copilot write-oriented tool completes successfully
- **THEN** the translated `tool_result` includes `writtenFiles` entries for the files changed by that tool call
