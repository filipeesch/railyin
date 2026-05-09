## MODIFIED Requirements

### Requirement: Event translation
Pi SDK `AgentSessionEvent` events (a superset of `AgentEvent`) are translated to `EngineEvent` types compatible with Railyin's stream processor. The translator imports from `AgentSessionEvent` (not `AgentEvent`) to handle session-specific events including compaction lifecycle events.

#### Scenario: Streaming text
- **WHEN** Pi emits `message_update` with `assistantMessageEvent.type === "text_delta"`
- **THEN** a `{ type: "token", text: delta }` EngineEvent is emitted

#### Scenario: Streaming thinking
- **WHEN** Pi emits `message_update` with `assistantMessageEvent.type === "thinking_delta"`
- **THEN** a `{ type: "reasoning", text: delta }` EngineEvent is emitted

#### Scenario: Tool execution events
- **WHEN** Pi emits `tool_execution_start` / `tool_execution_end`
- **THEN** corresponding `tool_start` / `tool_result` EngineEvents are emitted
- **AND** `tool_result` includes `writtenFiles: FileDiffPayload[]` when the tool was a write operation

#### Scenario: Agent completion
- **WHEN** Pi emits `agent_end`
- **THEN** a `{ type: "done" }` EngineEvent is emitted and the stream closes

#### Scenario: Compaction started
- **WHEN** Pi SDK emits `compaction_start` (reason: threshold, overflow, or manual)
- **THEN** a `{ type: "compaction_start" }` EngineEvent is emitted to Railyin's stream

#### Scenario: Compaction completed
- **WHEN** Pi SDK emits `compaction_end` with `aborted: false`
- **THEN** a `{ type: "compaction_done" }` EngineEvent is emitted to Railyin's stream

#### Scenario: Compaction aborted
- **WHEN** Pi SDK emits `compaction_end` with `aborted: true`
- **THEN** no EngineEvent is emitted (aborted compaction leaves session unchanged)

## ADDED Requirements

### Requirement: Manual compaction delegates to Pi SDK
`PiEngine.compact()` SHALL call `session.compact()` on the active Pi SDK session for the given `conversationId`. Pi SDK performs the compaction using the local LLM and manages the session JSONL file.

#### Scenario: Manual compact triggers Pi SDK compaction
- **WHEN** `engine.compact(taskId, conversationId, workingDirectory)` is called
- **AND** a Pi session exists for `conversationId`
- **THEN** `session.compact()` is awaited
- **AND** Pi SDK emits `compaction_start` / `compaction_end` events which are forwarded to the stream

#### Scenario: Manual compact no-ops when no session exists
- **WHEN** `engine.compact()` is called for a `conversationId` with no active Pi session
- **THEN** the call returns without error (no session to compact)

### Requirement: listModels reports manual compaction support
Pi models listed by `listModels()` SHALL include `supportsManualCompact: true` to indicate that manual compaction is available via the compact button in the UI.

#### Scenario: supportsManualCompact flag in model list
- **WHEN** `engine.listModels()` is called
- **THEN** each returned `EngineModelInfo` includes `supportsManualCompact: true`
