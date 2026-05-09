## ADDED Requirements

### Requirement: Pi engine registration
PiEngine must be registered in the `engineFactories` map in `src/bun/index.ts` with key matching its `id` from `engines.yaml`.

#### Scenario: Engine factory instantiation
- **WHEN** the Bun server boots and `engines.yaml` contains an entry with `type: pi`
- **THEN** a `PiEngine` instance is created and registered in the engine registry

### Requirement: ExecutionEngine contract
PiEngine must fully implement the `ExecutionEngine` interface from `src/bun/engine/types.ts`. The resolved context window for compaction SHALL be read from `ExecutionParams.contextWindowOverride` when present, falling back to `this.config.context_window`, then to `DEFAULT_CONTEXT_WINDOW` (128,000). PiEngine SHALL NOT call `getDb()` to resolve the context window — this value is injected by the orchestrator via `ExecutionParams`.

#### Scenario: execute() streams events
- **WHEN** `engine.execute(params)` is called
- **THEN** it returns an `AsyncIterable<EngineEvent>` that emits token, reasoning, tool_start, tool_result, and done events as Pi processes the prompt

#### Scenario: cancel() aborts Pi session
- **WHEN** `engine.cancel(executionId)` is called during streaming
- **THEN** the active Pi `AgentSession.abort()` is called and the stream terminates with no further events

#### Scenario: contextWindowOverride used for compaction threshold
- **WHEN** `ExecutionParams.contextWindowOverride` is provided (e.g., 32768)
- **THEN** the Pi engine's compaction threshold is `32768 - 16384 = 16384` tokens

#### Scenario: Falls back to config context_window when no override
- **WHEN** `ExecutionParams.contextWindowOverride` is absent and `PiEngineConfig.context_window` is 65536
- **THEN** the compaction threshold is `65536 - 16384 = 49152` tokens

#### Scenario: Falls back to DEFAULT_CONTEXT_WINDOW when neither override nor config present
- **WHEN** `ExecutionParams.contextWindowOverride` is absent and `PiEngineConfig.context_window` is undefined
- **THEN** the compaction threshold is `128000 - 16384 = 111616` tokens

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
One `AgentSession` is created per `conversationId` and reused across executions of the same conversation.

#### Scenario: Session creation on first execute
- **WHEN** `execute()` is called with a `conversationId` not yet in the session map
- **THEN** a new `AgentSession` is created via `SessionManager.create(worktreePath)` and stored in `Map<conversationId, AgentSession>`

#### Scenario: Session reuse on subsequent execute
- **WHEN** `execute()` is called with the same `conversationId` again
- **THEN** the existing `AgentSession` is reused (Pi retains its internal context/compaction state)

#### Scenario: Session disposal on task archive
- **WHEN** a task is archived or deleted
- **THEN** `session.dispose()` is called and the entry is removed from the session map

### Requirement: Tool injection
All Pi built-in tools are disabled; only Railyin tools are exposed to the model.

#### Scenario: No Pi built-in tools
- **WHEN** `createAgentSession` is called
- **THEN** `tools: []` is passed (disabling readTool, writeTool, editTool, bashTool, grepTool, findTool, lsTool)
- **AND** `customTools: buildPiTools(ctx, harnessCtx)` provides all Railyin tools

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
- **THEN** corresponding `tool_start` / `tool_result` EngineEvents are emitted
- **AND** `tool_result` includes `writtenFiles: FileDiffPayload[]` when the tool was a write operation

#### Scenario: Agent completion
- **WHEN** Pi emits `agent_end`
- **THEN** a `{ type: "done" }` EngineEvent is emitted and the stream closes
