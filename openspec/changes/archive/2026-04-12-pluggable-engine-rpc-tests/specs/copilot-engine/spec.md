## MODIFIED Requirements

### Requirement: CopilotEngine wraps the Copilot SDK as an ExecutionEngine
The system SHALL implement `CopilotEngine` conforming to the `ExecutionEngine` interface. It SHALL use `@github/copilot-sdk` through an engine-specific SDK adapter that can be replaced in tests. The engine SHALL use the adapter to create or resume agentic sessions, translate SDK events to `EngineEvent` types, and manage session lifecycle.

#### Scenario: CopilotEngine instantiates from config
- **WHEN** `workspace.yaml` has `engine.type: copilot`
- **THEN** a `CopilotEngine` instance is created and ready to accept `execute()` calls

#### Scenario: execute() creates or resumes a Copilot session and yields events
- **WHEN** `CopilotEngine.execute(params)` is called
- **THEN** the engine resumes the deterministic task session when available or creates it otherwise, sends the prompt via `session.send()`, and translates SDK events to `EngineEvent` for the caller

#### Scenario: cancel() disconnects the active session
- **WHEN** `CopilotEngine.cancel(executionId)` is called
- **THEN** the session associated with that execution is aborted, disconnected, and the engine stops yielding additional events for that execution

#### Scenario: Tests inject a mock Copilot SDK adapter
- **WHEN** a backend test constructs the real `CopilotEngine` with a mock Copilot SDK adapter
- **THEN** the engine executes against the mocked SDK classes without requiring live Copilot credentials

### Requirement: Copilot engine session lifecycle is one session context per task execution flow
The system SHALL maintain a deterministic SDK session identity per task so context can be resumed across turns while still isolating each in-flight execution by execution ID. The active session SHALL be disconnected when the execution completes, fails, or is cancelled. Copilot's `infiniteSessions` feature handles compaction within the session. Railyin SHALL NOT perform any compaction for the Copilot engine.

#### Scenario: Existing task session resumes on a later turn
- **WHEN** `execute()` is called again for the same task after a prior turn completed
- **THEN** the engine attempts to resume the task's deterministic Copilot session before creating a new one

#### Scenario: Resume failure falls back to session creation
- **WHEN** the deterministic task session cannot be resumed
- **THEN** the engine creates a new session with the same task-derived identity and continues execution

#### Scenario: Session disconnected on completion
- **WHEN** the execution completes normally
- **THEN** the Copilot session is disconnected and resources are released

#### Scenario: Session disconnected on cancellation
- **WHEN** `cancel(executionId)` is called
- **THEN** the Copilot session for that execution is aborted and disconnected

## ADDED Requirements

### Requirement: Copilot engine behaviors SHALL be verifiable with deterministic SDK mocks
The system SHALL support deterministic backend tests for Copilot engine behaviors including resume, create fallback, streaming output, tool execution, fatal failures, cancellation, and model listing using mocked Copilot SDK classes.

#### Scenario: Streaming output verified through mocked SDK events
- **WHEN** a mocked Copilot SDK session emits message, reasoning, tool, usage, and completion events
- **THEN** backend tests can verify the real Copilot engine's translated event stream and orchestrator-facing behavior

#### Scenario: Model listing verified through mocked SDK client
- **WHEN** a mocked Copilot SDK client returns a fixed set of Copilot models
- **THEN** backend tests can verify that `CopilotEngine.listModels()` returns the expected qualified model information
