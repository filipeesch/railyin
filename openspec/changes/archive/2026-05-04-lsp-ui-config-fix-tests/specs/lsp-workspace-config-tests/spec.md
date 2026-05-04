# Spec: LSP Workspace Config — Test Coverage

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

- **SCENARIO-LWC-T1**: First call creates manager via factory
  - Given a registry with a spy `managerFactory`
  - When `getManager("task-1", [cfg], "/projects/app")` is called
  - Then `managerFactory` is called once with `([cfg], "/projects/app")`
  - And the returned manager is the spy manager

- **SCENARIO-LWC-T2**: Cache hit skips factory
  - Given a manager already created for `("task-1", "/projects/app")`
  - When `getManager("task-1", [cfg], "/projects/app")` is called again
  - Then `managerFactory` is called exactly once (not twice)

- **SCENARIO-LWC-T3**: Stale path recreates manager
  - Given a manager already created for `("task-1", "/projects/app")`
  - When `getManager("task-1", [cfg], "/projects/app-v2")` is called
  - Then the old manager's `shutdown()` is called
  - And `managerFactory` is called a second time with `([cfg], "/projects/app-v2")`

- **SCENARIO-LWC-T4**: Empty configs returns null
  - When `getManager("task-1", [], "/projects/app")` is called
  - Then the result is `null`
  - And `managerFactory` is not called

- **SCENARIO-LWC-T5**: Release shuts down and evicts
  - Given a manager already created for `("task-1", "/projects/app")`
  - When `releaseTask("task-1")` is called
  - Then the manager's `shutdown()` is called
  - When `getManager("task-1", [cfg], "/projects/app")` is called again
  - Then `managerFactory` is called a second time (fresh manager)

- **SCENARIO-LWC-T6**: Two scopes are independent
  - Given managers for `("task-1", "/p1")` and `("task-2", "/p2")`
  - When `releaseTask("task-1")`
  - Then `getManager("task-2", ...)` still returns the cached task-2 manager without calling factory again

### lspHandlers — Integration

- **SCENARIO-LWC-T7**: addToConfig writes to correct workspace
  - Given two workspace configs: `default` with server `ts`, `secondary` with no servers
  - When `lspHandlers.addToConfig({ workspaceKey: "secondary", serverName: "ts" })` is called
  - Then `secondary`'s yaml file contains `lsp.servers: [ts]`
  - And `default`'s yaml file is unchanged

- **SCENARIO-LWC-T8**: runInstall calls installer with correct workspace; writes on success
  - Given a fake installer that resolves successfully
  - When `lspHandlers.runInstall({ workspaceKey: "secondary", serverName: "ts" })` is called
  - Then the fake installer is called with `("secondary", "ts")`
  - And `secondary`'s yaml has `ts` in `lsp.servers`

- **SCENARIO-LWC-T9**: runInstall does not write on installer failure
  - Given a fake installer that rejects
  - When `lspHandlers.runInstall(...)` is called
  - Then the workspace yaml is unchanged

- **SCENARIO-LWC-T10**: workspaceSymbol uses worktree_path when set
  - Given task with `worktree_path = "/projects/app"`
  - When `lspHandlers.workspaceSymbol({ taskId: ..., query: "Foo" })` is called
  - Then the fake registry's `getManager` is called with `/projects/app`

- **SCENARIO-LWC-T11**: workspaceSymbol falls back to project path
  - Given task with `worktree_path = null` in workspace `ws2` with project path `/workspace/ws2`
  - When `lspHandlers.workspaceSymbol(...)` is called
  - Then the fake registry's `getManager` is called with `/workspace/ws2`

- **SCENARIO-LWC-T12**: workspaceSymbol returns empty array when no servers
  - Given workspace with no `lsp.servers`
  - When `lspHandlers.workspaceSymbol(...)` is called
  - Then result is `[]`

### ExecutionParamsBuilder — Unit

- **SCENARIO-LWC-T13**: build() includes workspaceKey
  - Given a task in workspace `ws2`
  - When `builder.build(task, ...)` is called
  - Then `params.workspaceKey === "ws2"`

### Orchestrator — Integration

- **SCENARIO-LWC-T14**: workspaceKey flows to engine
  - Given a board in workspace `ws2` and a task on that board
  - When the orchestrator runs an execution with a `CapturingEngine`
  - Then the captured `ExecutionParams.workspaceKey === "ws2"`
