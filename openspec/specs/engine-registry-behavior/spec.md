## ADDED Requirements

### Requirement: EngineRegistry creates engines lazily via injected factory
`EngineRegistry` SHALL accept a factory function `(workspaceKey: string) => ExecutionEngine` in its constructor. On the first call to `getEngine(workspaceKey)`, it SHALL invoke the factory and cache the result. Subsequent calls with the same key SHALL return the cached instance without invoking the factory again.

#### Scenario: Factory called once per workspace key
- **WHEN** `getEngine("ws-a")` is called twice with the same key
- **THEN** the factory is invoked exactly once and the same engine instance is returned both times

#### Scenario: Separate factory call per distinct workspace key
- **WHEN** `getEngine("ws-a")` and `getEngine("ws-b")` are each called once
- **THEN** the factory is invoked once for each key, returning independent engine instances

### Requirement: EngineRegistry delegates cancelAll to the cached engine
`EngineRegistry.cancelAll(executionId, workspaceKey)` SHALL call `engine.cancel(executionId)` on the cached engine for that workspace key. If no engine is cached for the key, it SHALL be a no-op.

#### Scenario: Cancel delegates to resolved engine
- **WHEN** `getEngine("ws-a")` has been called (engine cached) and `cancelAll(42, "ws-a")` is called
- **THEN** the engine's `cancel(42)` method is invoked

#### Scenario: Cancel is no-op for unknown key
- **WHEN** `cancelAll(42, "unknown-key")` is called with no prior `getEngine` call for that key
- **THEN** no error is thrown and no factory call is made

### Requirement: Tests inject engines via factory without static helpers
All test construction of `EngineRegistry` SHALL use the constructor directly with a factory lambda. No static factory methods (`fromFixed`, `fromEnvironment`) SHALL be added to `EngineRegistry`.

#### Scenario: Single-engine test injection
- **WHEN** a test constructs `new EngineRegistry(() => new TestEngine())`
- **THEN** every `getEngine()` call returns an instance of `TestEngine`
