## MODIFIED Requirements

### Requirement: ExecutionEngine contract
PiEngine must fully implement the `ExecutionEngine` interface from `src/bun/engine/types.ts`. The resolved context window for compaction SHALL be read from `ExecutionParams.contextWindowOverride` when provided to `execute()`. PiEngine SHALL NOT fall back to `config.context_window` or any hardcoded default — if `contextWindowOverride` is absent or null at the time `buildModel()` is called, the method SHALL throw. PiEngine SHALL accept `ModelSettingsRepository` and `workspaceKey` as constructor parameters injected at registration time.

#### Scenario: execute() streams events
- **WHEN** `engine.execute(params)` is called
- **THEN** it returns an `AsyncIterable<EngineEvent>` that emits token, reasoning, tool_start, tool_result, and done events as Pi processes the prompt

#### Scenario: execute() waits for SDK run to settle before emitting done
- **WHEN** `engine.execute(params)` is called and the Pi SDK emits `agent_end`
- **THEN** the `{ type: "done" }` EngineEvent is emitted only after the SDK run has fully settled (i.e., after `session.agent.waitForIdle()` resolves)

#### Scenario: cancel() aborts Pi session
- **WHEN** `engine.cancel(executionId)` is called during streaming
- **THEN** the active Pi `AgentSession.abort()` is called and the stream terminates with no further events

#### Scenario: contextWindowOverride used for compaction threshold
- **WHEN** `ExecutionParams.contextWindowOverride` is provided (e.g., 32768)
- **THEN** the Pi session's `model.contextWindow` is set to 32768, making the SDK threshold fire at `32768 - 16384 = 16384` tokens

#### Scenario: buildModel throws when contextWindow is null
- **WHEN** `buildModel()` is called without a resolved `contextWindowOverride`
- **THEN** an error is thrown and no session is created

#### Scenario: ModelSettingsRepository and workspaceKey injected at construction
- **WHEN** the engine factory creates a `PiEngine` in `index.ts`
- **THEN** the `ModelSettingsRepository` instance and current `workspaceKey` are passed as constructor arguments

### Requirement: Session lifecycle
One `AgentSession` is created per `conversationId` and reused across executions of the same conversation. The engine SHALL maintain a mutable `CommonToolContext` ref per conversation (`commonCtxRefs: Map<conversationId, CommonToolContext>`), created on first execution and mutated in-place on reuse (mirroring the `harnessContexts` pattern). When `compact()` is called and no live session exists for the conversation, the engine SHALL restore the session from the persisted `.jsonl` file at `~/.railyin/pi-sessions/<hash>.jsonl` via `getOrCreateSession()` rather than silently skipping. The restored session SHALL be stored in the session map so subsequent executions can reuse it. `compact()` SHALL check `session.isCompacting` before calling `session.compact()` and throw `"Compaction already in progress"` if true.

On session reuse, the engine SHALL call `session.setActiveToolsByName(names)` to update the active tool set instead of assigning directly to `agent.state.tools`. The engine SHALL NOT call `buildAllTools()` on session reuse — tool closures remain valid because they close over the mutable `CommonToolContext` ref. The `runtime.worktreePath`, `runtime.lspManager`, and all `workflow` callback fields SHALL be updated in-place on the stored `commonCtxRef` before each execution.

#### Scenario: Session creation on first execute
- **WHEN** `execute()` is called with a `conversationId` not yet in the session map
- **THEN** a new `AgentSession` is created via `SessionManager.open(sessionPath)` and stored in `Map<conversationId, AgentSession>`
- **AND** a `CommonToolContext` is created and stored in `commonCtxRefs` for that `conversationId`

#### Scenario: Session reuse on subsequent execute
- **WHEN** `execute()` is called with the same `conversationId` again
- **THEN** the existing `AgentSession` is reused (Pi retains its internal context/compaction state)
- **AND** `session.setActiveToolsByName()` is called to sync the active tool set from the SDK registry
- **AND** `agent.state.tools` is NOT directly assigned
- **AND** `buildAllTools()` is NOT called again

#### Scenario: CommonToolContext mutable fields updated on reuse
- **WHEN** `execute()` is called for a conversation that already has a `commonCtxRef`
- **THEN** `commonCtxRef.runtime.worktreePath` is updated to the current working directory
- **AND** `commonCtxRef.runtime.lspManager` is updated to the current LSP manager
- **AND** `commonCtxRef.workflow` callbacks are updated to the current execution's callbacks
- **AND** tool closures see these updated values without rebuilding

#### Scenario: SDK built-in tools remain active on turn 2+
- **WHEN** `execute()` is called for a second time on the same conversation
- **THEN** the `read`, `grep`, `find`, and `ls` SDK built-in tools remain callable
- **AND** no "tool not found" error is returned for these tools

#### Scenario: Session disposal on task archive
- **WHEN** a task is archived or deleted
- **THEN** `session.dispose()` is called and the entry is removed from the session map
- **AND** the corresponding `commonCtxRef` is removed from `commonCtxRefs`

#### Scenario: compact() restores session from disk when not in memory
- **WHEN** `compact()` is called for a conversationId not in the session map
- **THEN** `getOrCreateSession()` is called to restore from the path resolved by the injected `SessionPathResolver`, the session is stored in the map, and compaction proceeds

### Requirement: SessionPathResolver dependency
`PiSessionManager` SHALL receive a `SessionPathResolver` interface (`pathForConversation(conversationId): string`) via constructor injection. Production wiring SHALL use a SHA1-based resolver under `~/.railyin/pi-sessions/`. Unit and integration tests SHALL inject a temp-path resolver so disk-restore tests are isolated and do not pollute the production sessions directory.

#### Scenario: Production resolver uses ~/.railyin/pi-sessions
- **WHEN** the production `createPiEngine()` factory wires the session manager
- **THEN** the resolver returns paths under `~/.railyin/pi-sessions/<hash>.jsonl`

#### Scenario: Test resolver uses temp directory
- **GIVEN** a test injecting a temp-directory `SessionPathResolver`
- **WHEN** `PiSessionManager` creates and restores sessions
- **THEN** all session files are written under the temp directory and cleaned up by the test

#### Scenario: compact() throws when already compacting
- **WHEN** `compact()` is called and `session.isCompacting` returns true
- **THEN** `"Compaction already in progress"` is thrown

### Requirement: Event translation
Pi SDK `AgentSessionEvent` events (a superset of `AgentEvent`) are translated to `EngineEvent` types compatible with Railyin's stream processor. The translator imports from `AgentSessionEvent` (not `AgentEvent`) to handle session-specific events including compaction lifecycle events.

#### Scenario: Streaming text
- **WHEN** Pi emits `message_update` with `assistantMessageEvent.type === "text_delta"`
- **THEN** a `{ type: "token", text: delta }` EngineEvent` is emitted

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

### Requirement: Faux-provider no-output regression test
A new integration test SHALL use `registerFauxProvider` to script an assistant response where final text deltas and `agent_end` arrive after `session.prompt()` resolves. The test SHALL drive `PiEngine.execute()` end-to-end and verify that at least one non-empty `token` event is emitted before the `{ type: "done" }` event. This test directly validates that the engine waits for `session.agent.waitForIdle()` before closing the stream.

#### Scenario: Faux provider emits final deltas after prompt resolves
- **GIVEN** a faux provider scripted with an assistant message whose text deltas are deferred until after `session.prompt()` resolves
- **WHEN** `engine.execute(params)` is consumed to completion
- **THEN** the stream emits one or more `token` events containing the assistant text
- **AND** the stream emits `{ type: "done" }` after all token events
- **AND** no "Agent completed with no output" warning is produced

## REMOVED Requirements

### Requirement: buildCompactionSettings helper
**Reason**: The helper returned settings that were never used in production code; the engine configures compaction directly via `SettingsManager.inMemory({ compaction: { enabled: false, reserveTokens: 16384, keepRecentTokens: 20000 } })`.
**Migration**: No migration needed. Any tests asserting `buildCompactionSettings()` should be removed or updated to assert the actual `SettingsManager` compaction options passed to the session factory.
