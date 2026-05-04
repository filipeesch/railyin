## Why

LSP language server setup is broken for multi-workspace scenarios: servers are always written to and read from the default workspace regardless of which workspace the project belongs to, making LSP non-functional for any workspace beyond the first. Additionally, there is no way to configure LSP for already-registered projects, task executions always boot LSP servers with the default workspace config, and the existing LSP setup UI is completely non-functional due to two bugs in `LspSetupPrompt` and `SetupView`.

## What Changes

- **BREAKING** `lsp.addToConfig` RPC params add required `workspaceKey: string` — callers must pass the target workspace
- **BREAKING** `lsp.runInstall` RPC params add required `workspaceKey: string` — callers must pass the target workspace
- `lsp.addToConfig` and `lsp.runInstall` handlers write to the correct workspace `workspace.yaml` (using `getConfigDir(workspaceKey)`)
- Both execution engines (`CopilotEngine`, `ClaudeEngine`) read `lsp.servers` from the correct workspace config keyed by the task's workspace, not always the default
- `workspaceKey` is threaded through `ExecutionParams` so engines receive it without DB lookups
- `TaskLSPRegistry.getManager()` detects when a task's worktree path has changed and recreates the LSP manager with the new path instead of silently using a stale one
- `lsp.workspaceSymbol` falls back to the task's project path (from workspace config) when `worktree_path` is null, instead of `process.cwd()`
- A "Configure LSP" icon button is added to each project row in SetupView, allowing LSP setup to be triggered for existing projects — not only on first registration
- `LspSetupPrompt` receives a `workspaceKey` prop so all LSP API calls carry the correct workspace context
- `LspSetupPrompt.selectedOption` reactive initialization bug fixed — `reactive()` was incorrectly passed a factory function instead of a plain object, causing all install options to be permanently `undefined` and the Install button to be permanently disabled
- `SetupView` missing `@done` handler on `LspSetupPrompt` fixed — the prompt could appear but never be dismissed
- `TaskLSPRegistry` and `lspHandlers` gain DI constructor/parameter seams (manager factory + registry injection) enabling clean testing without process spawning
- `setupTestConfig` test helper gains `extraWorkspaces` parameter for multi-workspace backend tests
- `@deprecated` annotation removed from `WorkspaceYaml.lsp` — it is the active LSP config, not a legacy field

## Capabilities

### New Capabilities

- `lsp-workspace-config`: LSP server detection, installation, and config-writing scoped to the correct workspace; "Configure LSP" entry point accessible for existing projects

### Modified Capabilities

- `project-management`: Project list row gains a "Configure LSP" action button alongside edit/delete

## Impact

- `src/shared/rpc-types.ts` — `lsp.addToConfig`, `lsp.runInstall` param types; `ExecutionParams.workspaceKey` added
- `src/bun/engine/types.ts` — `ExecutionParams` interface
- `src/bun/engine/execution/execution-params-builder.ts` — `build()` receives and passes `workspaceKey`
- `src/bun/engine/orchestrator.ts` — passes `getBoardWorkspaceKey(task.board_id)` when building params
- `src/bun/engine/copilot/engine.ts` — uses `params.workspaceKey` for `getConfig()`
- `src/bun/engine/claude/engine.ts` — uses `params.workspaceKey` for `getConfig()`
- `src/bun/lsp/task-registry.ts` — stale path detection in `getManager()`
- `src/bun/handlers/lsp.ts` — correct workspace writes + project-path fallback
- `src/bun/config/index.ts` — remove `@deprecated` from `LspConfig`
- `src/mainview/components/LspSetupPrompt.vue` — new `workspaceKey` + `dismissOnly` props; fix `reactive()` factory bug
- `src/mainview/views/SetupView.vue` — "Configure LSP" button per project row; add `@done` handler
- `src/bun/lsp/task-registry.ts` — DI constructor seam (`managerFactory`)
- `src/bun/handlers/lsp.ts` — DI parameter seam (`registry`, `installer`)
- `src/bun/test/helpers.ts` — `setupTestConfig` gains `extraWorkspaces` parameter
