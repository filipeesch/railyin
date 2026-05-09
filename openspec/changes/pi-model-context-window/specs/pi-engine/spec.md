## MODIFIED Requirements

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

## MODIFIED Requirements

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
