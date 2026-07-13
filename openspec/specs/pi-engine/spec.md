# Pi Engine

## Purpose
Documents the Pi engine's capabilities, contracts, and behavior in the Railyin system.

## Requirements

### Requirement: Pi engine registration
PiEngine must be registered in the `engineFactories` map in `src/bun/index.ts` with key matching its `id` from `engines.yaml`.

#### Scenario: Engine factory instantiation
- **WHEN** the Bun server boots and `engines.yaml` contains an entry with `type: pi`
- **THEN** a `PiEngine` instance is created and registered in the engine registry

### Requirement: ExecutionEngine contract
PiEngine must fully implement the `ExecutionEngine` interface from `src/bun/engine/types.ts`. The resolved context window for compaction SHALL be read from `ExecutionParams.contextWindowOverride` when provided to `execute()`. PiEngine SHALL NOT fall back to `config.context_window` or any hardcoded default — if `contextWindowOverride` is absent or null at the time `buildModel()` is called, the method SHALL throw. PiEngine SHALL accept `ModelSettingsRepository` and `workspaceKey` as constructor parameters injected at registration time.

#### Scenario: execute() streams events
- **WHEN** `engine.execute(params)` is called
- **THEN** it returns an `AsyncIterable<EngineEvent>` that emits token, reasoning, tool_start, tool_result, and done events as Pi processes the prompt

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

#### Scenario: execute() waits for SDK run to settle before emitting done
- **WHEN** `engine.execute(params)` is called and the Pi SDK emits `agent_end`
- **THEN** the `{ type: "done" }` EngineEvent is emitted only after the SDK run has fully settled (i.e., after `session.agent.waitForIdle()` resolves)

### Requirement: listModels() from config
The Pi engine's `listModels()` SHALL query `GET {base_url}/v1/models` (not `/models`) on each configured provider. Each returned `EngineModelInfo` SHALL include `contextWindowEditable: true`. The `contextWindow` value SHALL be: server-reported `context_length` from `/v1/models` response if present, otherwise `null` (the caller resolves the final effective value using `model_settings` overrides and the engine default).

#### Scenario: listModels uses correct /v1/models path
- **WHEN** `engine.listModels()` is called and the provider is reachable
- **THEN** the HTTP request is made to `{base_url}/v1/models` (with `/v1` prefix)

#### Scenario: listModels sets contextWindowEditable on every model
- **WHEN** `engine.listModels()` returns model entries
- **THEN** every entry has `contextWindowEditable: true`

#### Scenario: listModels passes through server context_length when present
- **WHEN** the `/v1/models` response includes `context_length: 32768` for a model
- **THEN** the returned `EngineModelInfo` has `contextWindow: 32768`

#### Scenario: listModels returns null contextWindow when server omits it
- **WHEN** the `/v1/models` response does not include `context_length` for a model
- **THEN** the returned `EngineModelInfo` has `contextWindow: null`

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

#### Scenario: compact() throws when already compacting
- **WHEN** `compact()` is called and `session.isCompacting` returns true
- **THEN** `"Compaction already in progress"` is thrown

### Requirement: Tool injection
The Pi engine's `createAgentSession` call SHALL include a `tools` allowlist derived dynamically from the built `piTools` array, prefixed with the SDK built-in names from `SDK_BUILTIN_TOOL_NAMES`. The allowlist SHALL be constructed via `buildToolAllowlist(piTools)` — a shared helper in `pi/constants.ts` — rather than a hardcoded string array. This ensures any tool registered in `buildAllTools()` is automatically included. The custom `"read_file"` tool SHALL NOT be included in the allowlist (its code is retained but not injected). Enabling `"read"` satisfies the Pi SDK's `selectedTools.includes("read")` guard, which gates skill injection into the system prompt. On session reuse, `setActiveToolsByName` SHALL also use `buildToolAllowlist(tools)`.

#### Scenario: read tool present in allowlist
- **WHEN** `createAgentSession` is called for a new Pi session
- **THEN** the `tools` array contains `"read"`
- **AND** the `tools` array does NOT contain `"read_file"`

#### Scenario: Note tools present in allowlist on session creation
- **WHEN** `createAgentSession` is called for a new Pi session
- **THEN** the `tools` array contains `"create_note"`, `"list_notes"`, and `"update_note"`

#### Scenario: Note tools present in allowlist on session reuse
- **WHEN** `setActiveToolsByName` is called for an existing Pi session
- **THEN** the names array contains `"create_note"`, `"list_notes"`, and `"update_note"`

#### Scenario: Skills injected into system prompt when dialect returns paths
- **WHEN** the configured dialect returns one or more skill paths (e.g., `.github/skills/`)
- **AND** skill files exist at those paths
- **THEN** the skills are appended to the system prompt visible to the LLM at session creation

#### Scenario: Skills NOT injected when no skill paths
- **WHEN** the configured dialect returns an empty skill path list (e.g., `NullDialect`)
- **THEN** no skills section appears in the system prompt

### Requirement: buildToolAllowlist shared helper
A `buildToolAllowlist(tools: AgentTool<any>[]): string[]` function SHALL exist in `src/bun/engine/pi/constants.ts`. It SHALL return `[...SDK_BUILTIN_TOOL_NAMES, ...tools.map(t => t.name)]`. All three Pi allowlist construction sites — `defaultSessionFactory`, session-reuse `setActiveToolsByName`, and `child-session.ts` — SHALL use this helper exclusively.

#### Scenario: buildToolAllowlist includes SDK built-in names
- **WHEN** `buildToolAllowlist([])` is called
- **THEN** the result contains all entries from `SDK_BUILTIN_TOOL_NAMES` (`"read"`, `"grep"`, `"find"`, `"ls"`)

#### Scenario: buildToolAllowlist includes all passed tool names
- **WHEN** `buildToolAllowlist([{ name: "create_note" }, { name: "list_todos" }])` is called
- **THEN** the result contains `"create_note"` and `"list_todos"` in addition to the built-ins

### Requirement: Explicit skill invocation unaffected
`additionalSkillPaths` SHALL remain set on `DefaultResourceLoader` so that `resourceLoader.getSkills()` returns the correct skills for explicit `/skill:name` invocations within the Pi session. This is independent of system prompt injection.

#### Scenario: Explicit skill invocation resolves correctly
- **WHEN** a user sends `/skill:openspec-propose` in a Pi session
- **AND** the copilot dialect returned `.github/skills/` as a skill path
- **THEN** the Pi SDK resolves the skill by name from the loaded skill list

### Requirement: Event translation
Pi SDK `AgentSessionEvent` events (a superset of `AgentEvent`) SHALL be translated to `EngineEvent` types compatible with Railyin's stream processor. The translator imports from `AgentSessionEvent` (not `AgentEvent`) to handle session-specific events including compaction lifecycle events.

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

### Requirement: Faux-provider no-output regression test
A new integration test SHALL use `registerFauxProvider` to script an assistant response where final text deltas and `agent_end` arrive after `session.prompt()` resolves. The test SHALL drive `PiEngine.execute()` end-to-end and verify that at least one non-empty `token` event is emitted before the `{ type: "done" }` event. This test directly validates that the engine waits for `session.agent.waitForIdle()` before closing the stream.

#### Scenario: Faux provider emits final deltas after prompt resolves
- **GIVEN** a faux provider scripted with an assistant message whose text deltas are deferred until after `session.prompt()` resolves
- **WHEN** `engine.execute(params)` is consumed to completion
- **THEN** the stream emits one or more `token` events containing the assistant text
- **AND** the stream emits `{ type: "done" }` after all token events
- **AND** no "Agent completed with no output" warning is produced

#### Scenario: Compaction started
- **WHEN** Pi SDK emits `compaction_start` (reason: threshold, overflow, or manual)
- **THEN** a `{ type: "compaction_start" }` EngineEvent is emitted to Railyin's stream

#### Scenario: Compaction completed
- **WHEN** Pi SDK emits `compaction_end` with `aborted: false`
- **THEN** a `{ type: "compaction_done" }` EngineEvent is emitted to Railyin's stream

#### Scenario: Compaction aborted
- **WHEN** Pi SDK emits `compaction_end` with `aborted: true`
- **THEN** no EngineEvent is emitted (aborted compaction leaves session unchanged)

### Requirement: Manual compaction delegates to Pi SDK
`PiEngine.compact()` SHALL call `session.compact()` on the active Pi SDK session for the given `conversationId`. Pi SDK performs the compaction using the local LLM and manages the session JSONL file.

#### Scenario: Manual compact triggers Pi SDK compaction
- **WHEN** `engine.compact(taskId, conversationId, workingDirectory)` is called
- **AND** a Pi session exists for `conversationId`
- **THEN** `session.compact()` is awaited
- **AND** Pi SDK emits `compaction_start` / `compaction_end` events which are forwarded to the stream

#### Scenario: Manual compact restores session from disk when not in memory
- **WHEN** `engine.compact()` is called for a `conversationId` with no active Pi session in memory
- **THEN** `getOrCreateSession()` is called to restore from the path resolved by the injected `SessionPathResolver` and compaction proceeds normally

### Requirement: listModels reports manual compaction support
Pi models listed by `listModels()` SHALL include `supportsManualCompact: true` to indicate that manual compaction is available via the compact button in the UI.

#### Scenario: supportsManualCompact flag in model list
- **WHEN** `engine.listModels()` is called
- **THEN** each returned `EngineModelInfo` includes `supportsManualCompact: true`

### Requirement: Sampling preset applied via onPayload per execution
PiEngine SHALL resolve the sampling preset for each execution from `ExecutionParams.samplingPresetName` against its own `config.sampling_presets`, falling back to `config.default_sampling_preset`. When a preset resolves, PiEngine SHALL set `session.agent.onPayload` to a function that merges the preset's defined fields into the raw LLM API request body. When no preset resolves, PiEngine SHALL set `session.agent.onPayload = undefined` to clear any value from a prior execution on the same reused session.

#### Scenario: onPayload injects resolved preset fields
- **WHEN** `createManagedExecution()` runs with `ExecutionParams.samplingPresetName = "creative"` and `config.sampling_presets.creative = { temperature: 1.2, top_p: 0.98 }`
- **THEN** `session.agent.onPayload` is set to a function that returns `{ ...payload, temperature: 1.2, top_p: 0.98 }`

#### Scenario: onPayload cleared when no preset resolves
- **WHEN** `createManagedExecution()` runs with no resolvable preset after a prior execution that had set `onPayload`
- **THEN** `session.agent.onPayload` is set to `undefined`, preventing prior execution's values from leaking

#### Scenario: Only defined preset fields are injected
- **WHEN** a preset defines `temperature: 0.5` but omits `top_p`, `top_k`, and `presence_penalty`
- **THEN** only `temperature` is merged into the payload; `top_p`, `top_k`, and `presence_penalty` are not present in the merged object

### Requirement: samplingPresetName flows through ExecutionParams
`ExecutionParams` SHALL include an optional `samplingPresetName?: string` field. `TransitionExecutor` SHALL populate this field from `column.sampling_preset` when building `ExecutionParams`. PiEngine is the only consumer that resolves the name to values; other engines SHALL ignore `samplingPresetName`.

#### Scenario: TransitionExecutor passes column sampling_preset as samplingPresetName
- **WHEN** the column config has `sampling_preset: balanced`
- **THEN** `ExecutionParams.samplingPresetName` equals `"balanced"` after `TransitionExecutor` builds the params

#### Scenario: samplingPresetName is undefined when column has no preset
- **WHEN** the column config has no `sampling_preset` field
- **THEN** `ExecutionParams.samplingPresetName` is `undefined`

### Requirement: Pi engine resets the loop detector at the start of each execution and wires beforeToolCall
At the beginning of each `createManagedExecution()` invocation, the Pi engine SHALL call `harnessCtx.loopDetector.reset()`. It SHALL then set `session.agent.beforeToolCall` to a function that calls `harnessCtx.loopDetector.record(toolName, args)` and, if it returns `true`, returns `{ block: true, reason: "Tool loop detected: '${toolName}' (or a group including it) has been called with the same arguments 3 times in the last 15 calls. Try a different approach or summarize your findings." }`. If `record` returns `false`, the hook SHALL return `undefined` to allow the call.

#### Scenario: Loop is blocked during an execution
- **GIVEN** a Pi engine execution is active
- **WHEN** `beforeToolCall` fires for the same `toolName+args` fingerprint for the 3rd time in the window
- **THEN** the call is blocked and the model receives a descriptive error tool result

#### Scenario: Loop detector resets between executions
- **GIVEN** a session that completed an execution where the loop detector was populated
- **WHEN** a new `createManagedExecution()` call starts for the same session
- **THEN** the loop detector is reset and the first `beforeToolCall` call in the new execution does not inherit old state

### Requirement: Child sessions are also guarded
`defaultChildSessionFactory` SHALL create a `new ToolLoopDetector()` for each child session and wire `session.agent.beforeToolCall` with the same block-and-hint logic before calling `session.prompt()`.

#### Scenario: Child session loop is blocked
- **GIVEN** a delegate child session is active
- **WHEN** `beforeToolCall` fires for the same fingerprint for the 3rd time within the child session's execution
- **THEN** the call is blocked and the child model receives a descriptive error tool result

### Requirement: SessionPathResolver dependency
`PiSessionManager` SHALL receive a `SessionPathResolver` interface (`pathForConversation(conversationId): string`) via constructor injection. Production wiring SHALL use a SHA1-based resolver under `~/.railyin/pi-sessions/`. Unit and integration tests SHALL inject a temp-path resolver so disk-restore tests are isolated and do not pollute the production sessions directory.

#### Scenario: Production resolver uses ~/.railyin/pi-sessions
- **WHEN** the production `createPiEngine()` factory wires the session manager
- **THEN** the resolver returns paths under `~/.railyin/pi-sessions/<hash>.jsonl`

#### Scenario: Test resolver uses temp directory
- **GIVEN** a test injecting a temp-directory `SessionPathResolver`
- **WHEN** `PiSessionManager` creates and restores sessions
- **THEN** all session files are written under the temp directory and cleaned up by the test

### Requirement: PiEngine loop guard wiring is covered by integration tests
`src/bun/test/pi/loop-detection-engine.test.ts` SHALL contain the following test cases (pattern: `MockBgSession` + `makePiEngine` + `runExecution`, same as `background-compaction.test.ts`):

- **LDE-1** `beforeToolCall` is wired after session creation — `session.agent.beforeToolCall` is not `undefined` after `execute()` begins
- **LDE-2** Detector resets between executions — execution 1 populates the detector (2 calls for same fingerprint); execution 2 makes 1 call for same fingerprint; no block fires in execution 2
- **LDE-3** Loop triggers block — `MockBgSession.prompt()` calls `beforeToolCall` 3× with the same fingerprint; verify the third call returns `{ block: true }` and includes a non-empty `reason` string
- **LDE-4** Same `conversationId` across two executions shares the same `loopDetector` instance (from `HarnessContext`) but has it reset
- **LDE-5** Different `conversationId`s get independent detectors — conv 101 loops (3 same-fingerprint calls), conv 102 makes the same calls independently; neither interferes with the other

### Requirement: buildDelegateTool child session loop guard is covered
`src/bun/test/pi/delegate.test.ts` SHALL contain the following additional test cases (DL-15–DL-18):

- **DL-15** `beforeToolCall` is wired — after `childSessionFactory` returns a `MockChildSession`, `session.agent.beforeToolCall` is set (not `undefined`) before `prompt()` is called
- **DL-16** Child loop triggers block — `MockChildSession` configured with a 3-call sequence for same fingerprint; verify the digest for that job contains the blocked-call error message
- **DL-17** Independent detectors per child job — job-A triggers its detector; job-B with same tool calls is clean; job-B's digest is normal
- **DL-18** No cross-job detector sharing — job-1 records 2 calls, job-2 records 2 calls for the same fingerprint; neither triggers (count is 2 in each isolated detector)
