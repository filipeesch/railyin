## MODIFIED Requirements

### Requirement: ExecutionEngine interface defines the contract for all engines
The system SHALL define an `ExecutionEngine` interface that all engines implement. The interface SHALL include:
- `execute(params: ExecutionParams): AsyncIterable<EngineEvent>` — run an execution
- `cancel(executionId: number): void` — abort a running execution
- `resume(executionId: number, input: EngineResumeInput): Promise<void>` — resume a paused execution with user input or a permission decision when the engine supports in-loop pauses
- `listModels(): Promise<EngineModelInfo[]>` — return models available through this engine

Every engine implementation SHALL conform to this interface in a way that preserves the shared orchestrator contract.

#### Scenario: Claude engine implements ExecutionEngine
- **WHEN** the engine resolver instantiates the Claude engine
- **THEN** the returned object satisfies the shared `ExecutionEngine` contract, including execution resumption for paused Claude flows

### Requirement: EngineEvent is a discriminated union covering all execution outputs
The `EngineEvent` type SHALL remain the shared event contract for all engines, including non-native interactive pauses. For engines that pause mid-execution, `ask_user` and `shell_approval` events SHALL carry enough serialized payload for the orchestrator to persist a prompt and later resume the same execution.

#### Scenario: ask_user event pauses a non-native execution
- **WHEN** a non-native engine yields an `ask_user` event
- **THEN** the orchestrator writes an `ask_user_prompt` conversation message, marks the task and execution as `waiting_user`, and keeps the execution resumable

#### Scenario: shell_approval event pauses a non-native execution
- **WHEN** a non-native engine yields a `shell_approval` event
- **THEN** the orchestrator writes an `ask_user_prompt` conversation message with a shell-approval payload, marks the task and execution as `waiting_user`, and keeps the execution resumable

### Requirement: Engine resolver instantiates the correct engine from workspace config
The system SHALL provide a `resolveEngine(config)` function that reads `engine.type` and returns the corresponding `ExecutionEngine` instance. Supported types SHALL include `native`, `copilot`, and `claude`.

#### Scenario: Claude engine resolved from config
- **WHEN** `workspace.yaml` has `engine.type: claude`
- **THEN** `resolveEngine` returns an instance of `ClaudeEngine`

### Requirement: Orchestrator consumes engine events and handles persistence and relay
The orchestrator SHALL consume the `AsyncIterable<EngineEvent>` produced by the engine and handle all engine-agnostic concerns: persisting conversation messages to the database, relaying streaming tokens to the frontend via RPC, updating execution and task state in the database, managing cancellation/resume lifecycle, and recording token usage.

For non-native engines that pause for input, the orchestrator SHALL treat `waiting_user` as a resumable state rather than a terminal stop.

#### Scenario: Waiting-user execution remains resumable
- **WHEN** a non-native execution pauses for a question or approval request
- **THEN** the task remains associated with the paused execution ID and the execution is not finalized as completed, failed, or cancelled

#### Scenario: User reply resumes paused execution instead of starting a new one
- **WHEN** a task is in `waiting_user` because a non-native execution requested input
- **THEN** the orchestrator routes the reply into `engine.resume(...)` for the same execution rather than creating a fresh execution row
