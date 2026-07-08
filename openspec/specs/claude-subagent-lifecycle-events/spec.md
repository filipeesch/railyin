## Purpose

The Claude subagent lifecycle events spec defines how the Claude engine tracks and emits structured events when subagents are spawned and completed, enabling the stream processor and UI to display subagent activity in the conversation timeline consistently with the Pi engine's delegate tool behavior.

## Requirements

### Requirement: ClaudeEngine emits subagent_start event when a subagent is spawned
The Claude engine SHALL register a `SubagentStart` SDK hook. When the hook fires, the engine SHALL emit a `{ type: "subagent_start", callId: string, intent: string, prompt: string }` engine event. The `callId` SHALL be derived from the `agent_id` field of the hook input. The `intent` SHALL be derived from the subagent's prompt (truncated to a summary). The `subagent_start` event SHALL be processed by the stream processor identically to how it processes `subagent_start` events from the Pi engine's delegate tool.

#### Scenario: Claude spawns a subagent — subagent_start event is emitted
- **WHEN** the Claude agent calls the `Agent` tool to spawn a subagent
- **THEN** the engine emits a `subagent_start` event with a non-empty `callId` and `intent` before any of the subagent's tool events appear in the stream

#### Scenario: subagent_start is persisted as a tool_call conversation message
- **WHEN** a `subagent_start` event is emitted
- **THEN** the stream processor persists a conversation message with `type = "tool_call"` and `subagentId` set to the `callId`, matching the existing Pi engine behavior

### Requirement: ClaudeEngine emits subagent_stop event when a subagent completes
The Claude engine SHALL register a `SubagentStop` SDK hook. When the hook fires, the engine SHALL emit a `{ type: "subagent_stop", callId: string }` engine event. The `callId` SHALL match the `callId` from the corresponding `subagent_start` event. The stream processor SHALL handle `subagent_stop` by closing the subagent container block in the UI.

#### Scenario: Subagent completes — subagent_stop event is emitted
- **WHEN** a subagent finishes execution (success or failure)
- **THEN** the engine emits a `subagent_stop` event with the `callId` matching the earlier `subagent_start` event

#### Scenario: subagent_stop callId matches subagent_start callId
- **WHEN** a `subagent_stop` event is processed
- **THEN** its `callId` field equals the `callId` of the previously emitted `subagent_start` event for the same subagent invocation

### Requirement: subagent_stop is a valid EngineEvent type
The `EngineEvent` union in `engine/types.ts` SHALL include `{ type: "subagent_stop"; callId: string }` as a valid member.

#### Scenario: EngineEvent union includes subagent_stop
- **WHEN** code emits `{ type: "subagent_stop", callId: "abc" }` as an `EngineEvent`
- **THEN** TypeScript accepts the value without a type error
