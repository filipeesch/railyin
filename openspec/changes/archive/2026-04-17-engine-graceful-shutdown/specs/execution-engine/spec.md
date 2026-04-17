## MODIFIED Requirements

### Requirement: ExecutionEngine interface defines the contract for all engines
The system SHALL define an `ExecutionEngine` interface that all engines implement. The interface SHALL include:
- `execute(params: ExecutionParams): AsyncIterable<EngineEvent>` — run an agentic execution
- `cancel(executionId: number): void` — abort a running execution
- `resume(executionId: number, input: EngineResumeInput): Promise<void>` — resume a paused execution with user input or a permission decision when the engine supports in-loop pauses
- `listModels(): Promise<EngineModelInfo[]>` — return models available through this engine
- `shutdown?(options?: { reason: "app-exit" | "workspace-reload" | "lifecycle-timeout"; deadlineMs?: number }): Promise<void>` — optional engine-wide graceful shutdown hook used by orchestrator for non-execution lifecycle cleanup

Every engine implementation SHALL conform to this interface in a way that preserves the shared orchestrator contract. The interface SHALL be defined in `src/bun/engine/types.ts`.

#### Scenario: Native engine implements ExecutionEngine
- **WHEN** the engine resolver instantiates the native engine
- **THEN** the returned object satisfies the `ExecutionEngine` interface and all required methods are callable

#### Scenario: Copilot engine implements ExecutionEngine
- **WHEN** the engine resolver instantiates the copilot engine
- **THEN** the returned object satisfies the `ExecutionEngine` interface and supports graceful shutdown through the shared lifecycle contract

#### Scenario: Claude engine implements ExecutionEngine
- **WHEN** the engine resolver instantiates the Claude engine
- **THEN** the returned object satisfies the shared `ExecutionEngine` contract, including execution resumption for paused Claude flows and graceful shutdown support

#### Scenario: execute returns an async iterable of EngineEvent
- **WHEN** `engine.execute(params)` is called
- **THEN** the return value is an `AsyncIterable<EngineEvent>` that yields events until the execution completes or is cancelled

## ADDED Requirements

### Requirement: Orchestrator SHALL perform graceful non-native shutdown on app exit
On application exit, the orchestrator SHALL invoke graceful engine shutdown for all active non-native engine leases before hard process termination fallback.

#### Scenario: App exit triggers orchestrated shutdown
- **WHEN** the application begins quit flow
- **THEN** the orchestrator requests graceful shutdown for active non-native engine leases with a bounded deadline

#### Scenario: Deadline fallback preserves app exit progress
- **WHEN** graceful shutdown exceeds the configured deadline
- **THEN** the application proceeds with fallback termination behavior without blocking indefinitely
