## ADDED Requirements

### Requirement: Pi engine compaction event translation
The Pi event translator SHALL handle `compaction_start` and `compaction_end` events from the Pi SDK and convert them into Railyin `EngineEvent` types so the stream processor can persist compaction summaries and update the UI.

#### Scenario: Compaction start event
- **WHEN** the Pi SDK emits `{ type: "compaction_start", reason: "threshold" | "overflow" | "manual" }`
- **THEN** `translateEvent` returns `[{ type: "compaction_start" }]`

#### Scenario: Compaction end with successful result
- **WHEN** the Pi SDK emits `{ type: "compaction_end", aborted: false, result: { summary: string } }`
- **THEN** `translateEvent` returns `[{ type: "compaction_done", summary: result.summary }]`

#### Scenario: Compaction end aborted or failed
- **WHEN** the Pi SDK emits `{ type: "compaction_end", aborted: true }` or `result` is undefined
- **THEN** `translateEvent` returns `[]` (no EngineEvent emitted)

### Requirement: Pi engine compact() persists summary
`PiEngine.compact()` SHALL invoke the Pi SDK's `session.compact()` and persist the resulting summary as a `compaction_summary` conversation message row, equivalent to the Copilot engine's compaction flow.

#### Scenario: Compact with live session
- **WHEN** `engine.compact(taskId, conversationId, workingDirectory)` is called and a live `AgentSession` exists for `conversationId`
- **THEN** `session.compact()` is awaited
- **AND** if the result contains a summary, a `compaction_summary` message row is appended to `conversation_messages` for that `conversationId`

#### Scenario: Compact with no live session
- **WHEN** `engine.compact()` is called but no session exists for `conversationId`
- **THEN** the method returns without error and logs a warning

#### Scenario: Compact result has no summary
- **WHEN** `session.compact()` resolves but `result.summary` is falsy
- **THEN** no `compaction_summary` row is written

## MODIFIED Requirements

### Requirement: Event translation
Pi SDK events are translated to `EngineEvent` types compatible with Railyin's stream processor.

#### Scenario: Streaming text
- **WHEN** Pi emits `message_update` with `assistantMessageEvent.type === "text_delta"`
- **THEN** a `{ type: "token", text: delta }` EngineEvent is emitted

#### Scenario: Streaming thinking
- **WHEN** Pi emits `message_update` with `assistantMessageEvent.type === "thinking_delta"`
- **THEN** a `{ type: "reasoning", text: delta }` EngineEvent is emitted

#### Scenario: Tool execution events
- **WHEN** Pi emits `tool_execution_start` / `tool_execution_end`
- **THEN** `tool_start` / `tool_result` EngineEvents are emitted with `name`, `callId`, and `result` fields

#### Scenario: Compaction events translated
- **WHEN** Pi emits `compaction_start` or `compaction_end`
- **THEN** the appropriate `compaction_start` or `compaction_done` EngineEvent is returned (per the Pi engine compaction event translation requirement above)

#### Scenario: Unknown events ignored
- **WHEN** Pi emits any other event type (e.g. `agent_start`, `turn_start`, `queue_update`)
- **THEN** `translateEvent` returns `[]`
