## ADDED Requirements

### Requirement: LSP server config is written to the correct workspace
The system SHALL write LSP server configuration to the workspace identified by the `workspaceKey` parameter, not to the default workspace. Both `lsp.addToConfig` and `lsp.runInstall` RPC methods SHALL accept a `workspaceKey: string` parameter and use it to resolve the target `workspace.yaml` file.

#### Scenario: addToConfig writes to specified workspace
- **WHEN** the frontend calls `lsp.addToConfig` with `{ workspaceKey: "my-workspace", ... }`
- **THEN** the server entry is appended to the `lsp.servers` list in `my-workspace`'s `workspace.yaml`, not the default workspace's config

#### Scenario: runInstall writes to specified workspace
- **WHEN** the frontend calls `lsp.runInstall` with `{ workspaceKey: "my-workspace", ... }`
- **THEN** the install result is persisted to `my-workspace`'s `workspace.yaml`

### Requirement: Task executions use LSP servers from the task's workspace
The system SHALL resolve LSP server configuration using the workspace key of the board the task belongs to. Execution engines SHALL NOT fall back to the default workspace config when reading `lsp.servers`.

#### Scenario: Engine reads correct workspace LSP servers
- **WHEN** a task execution starts for a task on a board belonging to workspace `"ws-a"`
- **THEN** the LSP manager is initialized with the `lsp.servers` list from `"ws-a"`'s config, not the default workspace

#### Scenario: workspaceKey is propagated via ExecutionParams
- **WHEN** the orchestrator builds execution params for a task
- **THEN** `ExecutionParams.workspaceKey` is set to the result of `getBoardWorkspaceKey(task.board_id)`

### Requirement: TaskLSPRegistry detects stale worktree paths and recreates managers
The system SHALL detect when a `getManager()` call is made with a `worktreePath` that differs from the cached entry for the same `scopeId`. When a path mismatch is detected, the old manager SHALL be shut down and a new manager SHALL be created with the updated path.

#### Scenario: Manager recreated when worktree path changes
- **WHEN** `getManager(scopeId, worktreePath, ...)` is called and the existing entry has a different `worktreePath`
- **THEN** the old manager is shut down, a new manager is created with the new path, and the new manager is returned

#### Scenario: Cached manager returned when path is unchanged
- **WHEN** `getManager(scopeId, worktreePath, ...)` is called and the existing entry has the same `worktreePath`
- **THEN** the existing manager is returned without recreation

### Requirement: lsp.workspaceSymbol falls back to project path when no worktree
The system SHALL use the task's project path (from workspace config) as the LSP root when `worktree_path` is null. The system SHALL NOT fall back to `process.cwd()`.

#### Scenario: workspaceSymbol uses worktree path when available
- **WHEN** a task has a non-null `worktree_path`
- **THEN** `lsp.workspaceSymbol` uses `worktree_path` as the LSP root for symbol lookup

#### Scenario: workspaceSymbol falls back to project path
- **WHEN** a task has `worktree_path = null`
- **THEN** `lsp.workspaceSymbol` resolves the task's project via workspace config and uses `project.projectPath.absolute` as the LSP root

### Requirement: LspSetupPrompt carries workspace context
The system SHALL provide a `workspaceKey` prop on `LspSetupPrompt`. All LSP API calls made from within the component (`lsp.addToConfig`, `lsp.runInstall`) SHALL include the value of this prop as the `workspaceKey` parameter.

#### Scenario: workspaceKey forwarded to addToConfig
- **WHEN** the user confirms LSP server selection in `LspSetupPrompt` with `workspaceKey = "ws-a"`
- **THEN** `lsp.addToConfig` is called with `{ workspaceKey: "ws-a", ... }`

#### Scenario: workspaceKey forwarded to runInstall
- **WHEN** the user triggers installation in `LspSetupPrompt` with `workspaceKey = "ws-a"`
- **THEN** `lsp.runInstall` is called with `{ workspaceKey: "ws-a", ... }`

### Requirement: LspSetupPrompt supports dismiss-only mode for existing projects
The system SHALL support a `dismissOnly: boolean` prop on `LspSetupPrompt`. When `dismissOnly` is true, the `done` event SHALL close the prompt without navigating to Boards.

#### Scenario: dismissOnly mode closes prompt without navigation
- **WHEN** `LspSetupPrompt` is rendered with `dismissOnly = true` and the user completes setup
- **THEN** the prompt is dismissed and no route navigation occurs

#### Scenario: Default mode navigates to Boards on completion
- **WHEN** `LspSetupPrompt` is rendered with `dismissOnly = false` (default) and the user completes setup
- **THEN** the app navigates to the Boards view as before
