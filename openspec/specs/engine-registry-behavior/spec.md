## Purpose
Defines the behavioral contract for `EngineRegistry` — pre-constructed singleton engine instances, routing by `QualifiedModelId`, cancel delegation, test injection patterns, and engine-type acceptance rules for leases.

## Requirements

### Requirement: EngineRegistry creates engines lazily via injected factory
**Superseded**: Registry no longer uses a lazy factory. It receives pre-constructed singleton instances keyed by engine ID.

The system SHALL replace the lazy-factory `EngineRegistry` constructor with one that accepts a `Map<engineId, ExecutionEngine>` of pre-constructed instances and a `getWorkspaceConfig` accessor for `allowed_engines` filtering. The factory-based constructor SHALL be removed.

#### Scenario: Registry constructed with pre-built instances
- **WHEN** `new EngineRegistry(new Map([["copilot", copilotEngine], ["claude", claudeEngine]]), getConfig)` is called
- **THEN** both engines are immediately available for routing without any factory invocation

#### Scenario: getEngineForModel routes by engineId
- **WHEN** `getEngineForModel("ws-a", QualifiedModelId.parse("claude/claude-sonnet"))` is called
- **THEN** the `ClaudeEngine` instance is returned

### Requirement: EngineRegistry delegates cancelAll to the cached engine
`EngineRegistry.cancelAll(executionId)` SHALL call `engine.cancel(executionId)` on ALL registered engine instances, regardless of workspace. If no engines are registered, it SHALL be a no-op.

#### Scenario: cancelAll dispatches to all engines
- **WHEN** the registry holds copilot and claude engines and `cancelAll(42)` is called
- **THEN** both engines' `cancel(42)` methods are invoked

#### Scenario: cancelAll is no-op when no engines registered
- **WHEN** the registry has an empty instance map and `cancelAll(1)` is called
- **THEN** no error is thrown

### Requirement: Tests inject engines directly without static helpers
All test construction of `EngineRegistry` SHALL pass a `Map<engineId, ExecutionEngine>` of mock instances directly to the constructor. The `fromFixed` static helper SHALL be removed.

#### Scenario: Test constructs registry with mock map
- **WHEN** a test calls `new EngineRegistry(new Map([["mock", mockEngine]]), () => config)`
- **THEN** `getEngineForModel("ws", QualifiedModelId.parse("mock/model"))` returns `mockEngine`

### Requirement: LeaseRegistry accepts any engine type string

The test suite SHALL contain a test that constructs a `LeaseRegistry` with `engine: "opencode"` and verifies that lease creation, state transitions, and expiry work identically to existing engine types.

#### Scenario: LeaseRegistry created with opencode engine type

- **WHEN** a `LeaseRegistry` is constructed with `engine: "opencode"`
- **THEN** `touch()`, `setState()`, and `release()` all behave correctly and the lease expires after the configured timeout

### Requirement: ER-DI-5 ClaudeEngine accepts IBoardRepository
The test suite SHALL verify that `ClaudeEngine` constructor accepts `IBoardRepository` as a required parameter.

#### Scenario: ER-DI-5.1 Constructor accepts boardRepo
- **WHEN** `new ClaudeEngine(..., boardRepo)` is called with a mock `IBoardRepository`
- **THEN** the engine is constructed without errors and stores the repository

### Requirement: ER-DI-6 CopilotEngine accepts IBoardRepository
The test suite SHALL verify that `CopilotEngine` constructor accepts `IBoardRepository` as a required parameter.

#### Scenario: ER-DI-6.1 Constructor accepts boardRepo
- **WHEN** `new CopilotEngine(..., boardRepo)` is called with a mock `IBoardRepository`
- **THEN** the engine is constructed without errors and stores the repository

### Requirement: ER-DI-7 PiEngine accepts IBoardRepository
The test suite SHALL verify that `PiEngine` constructor accepts `IBoardRepository` as a required parameter.

#### Scenario: ER-DI-7.1 Constructor accepts boardRepo
- **WHEN** `new PiEngine(..., boardRepo)` is called with a mock `IBoardRepository`
- **THEN** the engine is constructed without errors and stores the repository

### Requirement: ER-DI-8 OpenCodeEngine accepts IBoardRepository
The test suite SHALL verify that `OpenCodeEngine` constructor accepts `IBoardRepository` as a required parameter.

#### Scenario: ER-DI-8.1 Constructor accepts boardRepo
- **WHEN** `new OpenCodeEngine(..., boardRepo)` is called with a mock `IBoardRepository`
- **THEN** the engine is constructed without errors and stores the repository
