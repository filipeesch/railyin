## Purpose
Test coverage for LSP workspace config plumbing: `TaskLSPRegistry`, `lspHandlers`, `ExecutionParamsBuilder`, and the orchestrator's `workspaceKey` forwarding.

## Requirements

- **REQ-LWC-T1**: `TaskLSPRegistry.getManager(scopeId, configs, worktreePath)` returns a manager on first call for a given scope
- **REQ-LWC-T2**: Subsequent calls with the same `scopeId` and same `worktreePath` return the cached manager without creating a new one
- **REQ-LWC-T3**: When `worktreePath` changes for an existing `scopeId`, the old manager is shut down and a new manager is created
- **REQ-LWC-T4**: When `configs` is empty, `getManager` returns `null` without creating a manager
- **REQ-LWC-T5**: `releaseTask(scopeId)` shuts down the manager and removes it from the cache; subsequent `getManager` call creates a new manager
- **REQ-LWC-T6**: Two different `scopeId` values are tracked independently
- **REQ-LWC-T7**: `lspHandlers.addToConfig` writes to the workspace file identified by `workspaceKey`; the other workspace's file is not modified
- **REQ-LWC-T8**: `lspHandlers.runInstall` invokes the installer with the `workspaceKey` from params; on success the config is updated; on installer failure no config write occurs
- **REQ-LWC-T9**: `lspHandlers.workspaceSymbol` uses `task.worktree_path` as root when it is set
- **REQ-LWC-T10**: `lspHandlers.workspaceSymbol` falls back to the workspace project path when `task.worktree_path` is null
- **REQ-LWC-T11**: `lspHandlers.workspaceSymbol` returns an empty array when no LSP servers are configured for the workspace
- **REQ-LWC-T12**: `ExecutionParamsBuilder.build()` includes the `workspaceKey` from the task's workspace
- **REQ-LWC-T13**: The orchestrator passes `workspaceKey` in `ExecutionParams` to the engine

## Scenarios

### TaskLSPRegistry — Unit

#### Scenario: SCENARIO-LWC-T1 — First call creates manager via factory
- **GIVEN** a registry with a spy `managerFactory`
- **WHEN** `getManager("task-1", [cfg], "/projects/app")` is called
- **THEN** `managerFactory` is called once with `([cfg], "/projects/app")`
- **AND** the returned manager is the spy manager

#### Scenario: SCENARIO-LWC-T2 — Cache hit skips factory
- **GIVEN** a manager already created for `("task-1", "/projects/app")`
- **WHEN** `getManager("task-1", [cfg], "/projects/app")` is called again
- **THEN** `managerFactory` is called exactly once (not twice)

#### Scenario: SCENARIO-LWC-T3 — Stale path recreates manager
- **GIVEN** a manager already created for `("task-1", "/projects/app")`
- **WHEN** `getManager("task-1", [cfg], "/projects/app-v2")` is called
- **THEN** the old manager's `shutdown()` is called
- **AND** `managerFactory` is called a second time with `([cfg], "/projects/app-v2")`

#### Scenario: SCENARIO-LWC-T4 — Empty configs returns null
- **WHEN** `getManager("task-1", [], "/projects/app")` is called
- **THEN** the result is `null`
- **AND** `managerFactory` is not called

#### Scenario: SCENARIO-LWC-T5 — Release shuts down and evicts
- **GIVEN** a manager already created for `("task-1", "/projects/app")`
- **WHEN** `releaseTask("task-1")` is called
- **THEN** the manager's `shutdown()` is called
- **WHEN** `getManager("task-1", [cfg], "/projects/app")` is called again
- **THEN** `managerFactory` is called a second time (fresh manager)

#### Scenario: SCENARIO-LWC-T6 — Two scopes are independent
- **GIVEN** managers for `("task-1", "/p1")` and `("task-2", "/p2")`
- **WHEN** `releaseTask("task-1")`
- **THEN** `getManager("task-2", ...)` still returns the cached task-2 manager without calling factory again

### lspHandlers — Integration

#### Scenario: SCENARIO-LWC-T7 — addToConfig writes to correct workspace
- **GIVEN** two workspace configs: `default` with server `ts`, `secondary` with no servers
- **WHEN** `lspHandlers.addToConfig({ workspaceKey: "secondary", serverName: "ts" })` is called
- **THEN** `secondary`'s yaml file contains `lsp.servers: [ts]`
- **AND** `default`'s yaml file is unchanged

#### Scenario: SCENARIO-LWC-T8 — runInstall calls installer with correct workspace; writes on success
- **GIVEN** a fake installer that resolves successfully
- **WHEN** `lspHandlers.runInstall({ workspaceKey: "secondary", serverName: "ts" })` is called
- **THEN** the fake installer is called with `("secondary", "ts")`
- **AND** `secondary`'s yaml has `ts` in `lsp.servers`

#### Scenario: SCENARIO-LWC-T9 — runInstall does not write on installer failure
- **GIVEN** a fake installer that rejects
- **WHEN** `lspHandlers.runInstall(...)` is called
- **THEN** the workspace yaml is unchanged

#### Scenario: SCENARIO-LWC-T10 — workspaceSymbol uses worktree_path when set
- **GIVEN** task with `worktree_path = "/projects/app"`
- **WHEN** `lspHandlers.workspaceSymbol({ taskId: ..., query: "Foo" })` is called
- **THEN** the fake registry's `getManager` is called with `/projects/app`

#### Scenario: SCENARIO-LWC-T11 — workspaceSymbol falls back to project path
- **GIVEN** task with `worktree_path = null` in workspace `ws2` with project path `/workspace/ws2`
- **WHEN** `lspHandlers.workspaceSymbol(...)` is called
- **THEN** the fake registry's `getManager` is called with `/workspace/ws2`

#### Scenario: SCENARIO-LWC-T12 — workspaceSymbol returns empty array when no servers
- **GIVEN** workspace with no `lsp.servers`
- **WHEN** `lspHandlers.workspaceSymbol(...)` is called
- **THEN** result is `[]`

### ExecutionParamsBuilder — Unit

#### Scenario: SCENARIO-LWC-T13 — build() includes workspaceKey
- **GIVEN** a task in workspace `ws2`
- **WHEN** `builder.build(task, ...)` is called
- **THEN** `params.workspaceKey === "ws2"`

### Orchestrator — Integration

#### Scenario: SCENARIO-LWC-T14 — workspaceKey flows to engine
- **GIVEN** a board in workspace `ws2` and a task on that board
- **WHEN** the orchestrator runs an execution with a `CapturingEngine`
- **THEN** the captured `ExecutionParams.workspaceKey === "ws2"`
