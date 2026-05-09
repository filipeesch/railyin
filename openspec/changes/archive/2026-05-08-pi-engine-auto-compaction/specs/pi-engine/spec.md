## MODIFIED Requirements

### Requirement: Pi engine registration
PiEngine must be registered in the `engineFactories` map in `src/bun/index.ts` with key matching its `id` from `engines.yaml`.

#### Scenario: Engine factory instantiation
- **WHEN** the Bun server boots and `engines.yaml` contains an entry with `type: pi`
- **THEN** a `PiEngine` instance is created and registered in the engine registry

### Requirement: ExecutionEngine contract
PiEngine must fully implement the `ExecutionEngine` interface from `src/bun/engine/types.ts`.

#### Scenario: execute() streams events
- **WHEN** `engine.execute(params)` is called
- **THEN** it returns an `AsyncIterable<EngineEvent>` that emits token, reasoning, tool_start, tool_result, compaction_start, compaction_done, and done events as Pi processes the prompt

#### Scenario: cancel() aborts Pi session
- **WHEN** `engine.cancel(executionId)` is called during streaming
- **THEN** the active Pi `AgentSession.abort()` is called and the stream terminates with no further events

#### Scenario: listModels() from config
- **WHEN** `engine.listModels()` is called
- **THEN** it returns models derived from the `providers` block in `PiEngineConfig`

#### Scenario: context_window from config
- **WHEN** `engines.yaml` specifies `context_window: N` under a Pi engine entry
- **THEN** `buildModel()` uses that value as `model.contextWindow`
- **AND** Pi SDK compaction thresholds are based on that value

#### Scenario: context_window default
- **WHEN** `engines.yaml` does not specify `context_window`
- **THEN** `buildModel()` defaults to `128_000`
