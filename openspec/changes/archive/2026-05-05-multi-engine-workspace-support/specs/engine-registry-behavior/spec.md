## MODIFIED Requirements

### Requirement: EngineRegistry creates engines lazily via injected factory
**Reason for modification**: Registry no longer uses a lazy factory. It receives pre-constructed singleton instances keyed by engine ID.

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
