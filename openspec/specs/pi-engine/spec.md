## ADDED Requirements

### Requirement: Pi engine registration
PiEngine must be registered in the `engineFactories` map in `src/bun/index.ts` with key matching its `id` from `engines.yaml`.

#### Scenario: Engine factory instantiation
- **WHEN** the Bun server boots and `engines.yaml` contains an entry with `type: pi`
- **THEN** a `PiEngine` instance is created and registered in the engine registry

### Requirement: ExecutionEngine contract
PiEngine must fully implement the `ExecutionEngine` interface from `src/bun/engine/types.ts`.

#### Scenario: execute() streams events
- **WHEN** `engine.execute(params)` is called
- **THEN** it returns an `AsyncIterable<EngineEvent>` that emits token, reasoning, tool_start, tool_result, and done events as Pi processes the prompt

#### Scenario: cancel() aborts Pi session
- **WHEN** `engine.cancel(executionId)` is called during streaming
- **THEN** the active Pi `AgentSession.abort()` is called and the stream terminates with no further events

#### Scenario: listModels() from config
- **WHEN** `engine.listModels()` is called
- **THEN** it returns models derived from the `providers` block in `PiEngineConfig`

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
