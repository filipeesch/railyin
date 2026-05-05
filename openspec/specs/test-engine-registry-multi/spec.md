# Spec: test-engine-registry-multi

## Purpose

Specifies behavior of the `EngineRegistry` — routing, fallback, workspace-level engine filtering, lifecycle operations, and singleton instance semantics.

## Requirements

### Requirement: ER-routing
`getEngineForModel(workspaceKey, qmid)` routes to the correct engine by `qmid.engineId`.

#### Scenario: ER-1 routes copilot ID to copilot instance
- **WHEN** `getEngineForModel(ws, QualifiedModelId.parse("copilot/gpt-4.1"))` is called
- **THEN** returns the registered copilot `ExecutionEngine` instance

#### Scenario: ER-2 routes claude ID to claude instance
- **WHEN** `getEngineForModel(ws, QualifiedModelId.parse("claude/claude-sonnet"))` is called
- **THEN** returns the registered claude `ExecutionEngine` instance

#### Scenario: ER-3 routes opencode 3-part ID to opencode instance
- **WHEN** `getEngineForModel(ws, QualifiedModelId.parse("opencode/anthropic/claude-sonnet-4-5"))` is called
- **THEN** returns the registered opencode `ExecutionEngine` instance

---

### Requirement: ER-fallback
Unknown engine prefix falls back to the default engine.

#### Scenario: ER-4 unknown prefix returns default engine
- **WHEN** `getEngineForModel(ws, QualifiedModelId.parse("unknown/model"))` is called
- **THEN** returns the first engine in the registry (default)

---

### Requirement: ER-allowed-engines-filter
`allowed_engines` restricts engine availability per workspace.

#### Scenario: ER-5 engine not in allowed_engines returns default
- **WHEN** workspace has `allowed_engines: [copilot]` and `getEngineForModel` is called with a `claude/` ID
- **THEN** returns the default engine (copilot) instead of claude

#### Scenario: ER-6 listAllEngines respects allowed_engines
- **WHEN** workspace has `allowed_engines: [copilot]` and `listAllEngines(workspaceKey)` is called
- **THEN** returns only the copilot engine; claude is excluded

#### Scenario: ER-7 no allowed_engines returns all engines
- **WHEN** workspace has no `allowed_engines` and `listAllEngines(workspaceKey)` is called
- **THEN** returns all registered engines

---

### Requirement: ER-lifecycle
`cancelAll()` and `shutdown()` operate on all registered engine instances.

#### Scenario: ER-8 cancelAll dispatches to all instances
- **WHEN** `cancelAll(executionId)` is called with two engines registered
- **THEN** both engine instances have `cancelExecution(executionId)` called

#### Scenario: ER-9 shutdown calls all instances
- **WHEN** `shutdown()` is called
- **THEN** both engine instances have `shutdown()` called

---

### Requirement: ER-singleton
Engine instances are shared across workspaces (no per-workspace instantiation).

#### Scenario: ER-10 same instance returned for two workspaces
- **WHEN** `getEngineForModel` is called with the same engineId for two different workspace keys
- **THEN** both calls return the exact same engine object reference
