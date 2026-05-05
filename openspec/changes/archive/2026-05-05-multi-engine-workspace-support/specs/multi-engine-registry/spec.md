## ADDED Requirements

### Requirement: EngineRegistry holds pre-constructed singleton engine instances
The system SHALL construct all engine instances once at application startup from `engines.yaml` and pass them to `EngineRegistry` as a `Map<engineId, ExecutionEngine>`. The registry SHALL NOT use a lazy factory per workspace. Engine instances SHALL be shared across all workspaces.

#### Scenario: Registry receives pre-constructed instances
- **WHEN** `new EngineRegistry(instances, getWorkspaceConfig)` is called with a map of two engines
- **THEN** no engine factory is invoked at registry construction time

#### Scenario: Same instance returned for different workspaces
- **WHEN** workspace A and workspace B both allow engine `copilot`
- **THEN** `getEngineForModel("ws-a", copilotQmid)` and `getEngineForModel("ws-b", copilotQmid)` return the same `CopilotEngine` instance

### Requirement: EngineRegistry routes by QualifiedModelId.engineId
`EngineRegistry.getEngineForModel(workspaceKey, qmid)` SHALL return the engine whose `id` matches `qmid.engineId`. If the engine is not in the workspace's `allowed_engines`, or the engineId is not found, it SHALL fall back to the default engine (first in `engines.yaml` order).

#### Scenario: Routes to correct engine by prefix
- **WHEN** `getEngineForModel("ws", QualifiedModelId.parse("claude/claude-sonnet"))` is called
- **THEN** the `ClaudeEngine` instance is returned

#### Scenario: Falls back to default engine for unknown model prefix
- **WHEN** `getEngineForModel("ws", QualifiedModelId.parse("unknown/model"))` is called
- **THEN** the default engine (first in engines list) is returned without error

#### Scenario: Respects allowed_engines filter
- **WHEN** workspace allows only `[copilot]` and `getEngineForModel("ws", openCodeQmid)` is called
- **THEN** the default engine (copilot) is returned, not the OpenCode engine

### Requirement: EngineRegistry.listAllEngines returns workspace-filtered engines
`EngineRegistry.listAllEngines(workspaceKey)` SHALL return all engine instances permitted by the workspace's `allowed_engines` filter. When no filter is set, all engines are returned.

#### Scenario: listAllEngines returns all engines with no filter
- **WHEN** workspace has no `allowed_engines` and engines.yaml has 3 engines
- **THEN** `listAllEngines("ws")` returns all 3 engine instances

#### Scenario: listAllEngines respects allowed_engines
- **WHEN** workspace declares `allowed_engines: [copilot, claude]`
- **THEN** `listAllEngines("ws")` returns 2 engines, not the opencode engine

### Requirement: Composition root constructs engines via DI factory map; resolver.ts is deleted
All concrete engine construction (CopilotEngine, ClaudeEngine, OpenCodeEngine) SHALL occur in `src/bun/index.ts` via an `EngineFactoryMap`. `src/bun/engine/resolver.ts` SHALL be deleted. `EngineRegistry` SHALL import zero concrete engine classes.

#### Scenario: EngineRegistry has no imports of concrete engine classes
- **WHEN** `engine-registry.ts` is inspected
- **THEN** it contains no imports of `CopilotEngine`, `ClaudeEngine`, or `OpenCodeEngine`

#### Scenario: Tests inject engines directly without fromFixed helper
- **WHEN** a test constructs a registry
- **THEN** it passes a map of mock engine instances directly to the constructor
