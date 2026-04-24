## MODIFIED Requirements

### Requirement: ExecutionEngine interface defines the contract for all engines
The system SHALL define an `ExecutionEngine` interface that all supported engines implement. The interface SHALL include:
- `execute(params: ExecutionParams): AsyncIterable<EngineEvent>` — run an agentic execution
- `cancel(executionId: number): void` — abort a running execution
- `resume(executionId: number, input: EngineResumeInput): Promise<void>` — resume a paused execution with user input or a permission decision when the engine supports in-loop pauses
- `listModels(): Promise<EngineModelInfo[]>` — return models available through this engine
- `shutdown?(options?: { reason: "app-exit" | "workspace-reload" | "lifecycle-timeout"; deadlineMs?: number }): Promise<void>` — optional engine-wide graceful shutdown hook used by orchestrator for non-execution lifecycle cleanup

Every supported engine implementation SHALL conform to this interface in a way that preserves the shared orchestrator contract. The interface SHALL be defined in `src/bun/engine/types.ts`.

#### Scenario: Copilot engine implements ExecutionEngine
- **WHEN** the engine resolver instantiates the copilot engine
- **THEN** the returned object satisfies the `ExecutionEngine` interface and supports graceful shutdown through the shared lifecycle contract

#### Scenario: Claude engine implements ExecutionEngine
- **WHEN** the engine resolver instantiates the Claude engine
- **THEN** the returned object satisfies the shared `ExecutionEngine` contract, including execution resumption for paused Claude flows and graceful shutdown support

#### Scenario: execute returns an async iterable of EngineEvent
- **WHEN** `engine.execute(params)` is called
- **THEN** the return value is an `AsyncIterable<EngineEvent>` that yields events until the execution completes or is cancelled

### Requirement: Engine resolver instantiates the correct engine from workspace config
The system SHALL resolve the execution engine from the workspace that owns the task being executed, not from a single global workspace config. Supported engine types SHALL include `copilot` and `claude`.

#### Scenario: Task execution uses owning workspace config
- **WHEN** a task belongs to a board in workspace A
- **THEN** `resolveEngine` uses workspace A's resolved config for that execution

#### Scenario: Copilot engine resolved from config
- **WHEN** `workspace.yaml` has `engine.type: copilot`
- **THEN** `resolveEngine` returns an instance of `CopilotEngine`

#### Scenario: Claude engine resolved from config
- **WHEN** `workspace.yaml` has `engine.type: claude`
- **THEN** `resolveEngine` returns an instance of `ClaudeEngine`

#### Scenario: Unknown engine type rejected
- **WHEN** `workspace.yaml` has `engine.type: unsupported`
- **THEN** `resolveEngine` throws an error indicating the engine type is not supported

#### Scenario: Concurrent executions use different supported workspace engines
- **WHEN** one running task belongs to a `copilot` workspace and another running task belongs to a `claude` workspace
- **THEN** both executions proceed concurrently using their own workspace-specific engine instances and config

