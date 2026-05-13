## MODIFIED Requirements

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
