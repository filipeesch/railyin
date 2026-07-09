## ADDED Requirements

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

---

## Test Coverage

### Stream pipeline tests — `stream-pipeline-scenarios.test.ts` (new case)
Using `ScriptedEngine` (same pattern as S-13/S-14).

| ID | Scenario |
|----|---|
| S-15 | `subagent_stop` event closes the subagent bubble: IPC broadcast includes a `tool_result` block whose `blockId` matches the prior `subagent_start` `callId` |

### Integration tests — `claude-rpc-scenarios.test.ts` (new cases, see permission gate spec CRS-SA-3/4)
`MockClaudeSdkAdapter` needs two new mock step kinds to drive these tests:

```ts
{ kind: "subagent_start"; callId: string; intent: string; prompt: string }
{ kind: "subagent_stop"; callId: string }
```

When the mock executes a `subagent_start` step it yields `{ type: "subagent_start", callId, intent, prompt }` into the event stream. When it executes a `subagent_stop` step it yields `{ type: "subagent_stop", callId }`. This approach is pure DI — no alternative code paths in the adapter.

| ID | Scenario |
|----|---|
| CRS-SA-3 | `subagent_start` step → DB `conversation_messages` row with `type="tool_call"`, `subagentId=callId` |
| CRS-SA-4 | `subagent_stop` step after `subagent_start` → DB `conversation_messages` row with `type="tool_result"` matching `callId` |
