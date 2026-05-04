## 1. RPC Contract

- [x] 1.1 Add `workspaceKey: string` to `lsp.addToConfig` params in `src/shared/rpc-types.ts`
- [x] 1.2 Add `workspaceKey: string` to `lsp.runInstall` params in `src/shared/rpc-types.ts`
- [x] 1.3 Add `workspaceKey: string` to `ExecutionParams` interface in `src/bun/engine/types.ts`

## 2. Backend — LSP Handler Fixes

- [x] 2.1 Update `lsp.addToConfig` handler in `src/bun/handlers/lsp.ts` to call `getConfigDir(params.workspaceKey)` instead of `getConfigDir()`
- [x] 2.2 Update `lsp.runInstall` handler in `src/bun/handlers/lsp.ts` to call `getConfigDir(params.workspaceKey)` instead of `getConfigDir()`
- [x] 2.3 Update `lsp.workspaceSymbol` handler to resolve project path fallback: join `task.board_id` → `getBoardWorkspaceKey` → `getProjectByKey` → `project.projectPath.absolute` instead of `process.cwd()`
- [x] 2.4 Remove `@deprecated` annotation from `WorkspaceYaml.lsp` / `LspConfig` in `src/bun/config/index.ts`

## 3. Backend — Execution Engine Path

- [x] 3.1 Update `ExecutionParamsBuilder.build()` in `src/bun/engine/execution/execution-params-builder.ts` to accept and assign `workspaceKey`
- [x] 3.2 Update orchestrator in `src/bun/engine/orchestrator.ts` to pass `getBoardWorkspaceKey(task.board_id)` when calling `ExecutionParamsBuilder.build()`
- [x] 3.3 Update `CopilotEngine` in `src/bun/engine/copilot/engine.ts` to call `getConfig(params.workspaceKey)` instead of `getConfig()`
- [x] 3.4 Update `ClaudeEngine` in `src/bun/engine/claude/engine.ts` to call `getConfig(params.workspaceKey)` instead of `getConfig()`

## 4. Backend — TaskLSPRegistry Stale Path Fix

- [x] 4.1 In `TaskLSPRegistry.getManager()` (`src/bun/lsp/task-registry.ts`): compare incoming `worktreePath` against cached entry's path; if different, call `entry.manager.shutdown()`, delete the entry, then fall through to create a new manager

## 5. Frontend — LspSetupPrompt

- [x] 5.1 Add `workspaceKey: string` prop to `LspSetupPrompt.vue`
- [x] 5.2 Add `dismissOnly: boolean` prop (default `false`) to `LspSetupPrompt.vue`
- [x] 5.3 Pass `workspaceKey` prop value to `lsp.addToConfig` call in `LspSetupPrompt.vue`
- [x] 5.4 Pass `workspaceKey` prop value to `lsp.runInstall` call in `LspSetupPrompt.vue`
- [x] 5.5 In `LspSetupPrompt.vue` `done` handler: if `dismissOnly` is true, emit close/dismiss without routing; otherwise keep existing navigation to Boards
- [x] 5.6 Fix `selectedOption` initialization in `LspSetupPrompt.vue`: replace `reactive(() => { ... })` (broken factory form) with `reactive({})` populated via a `watchEffect` or `watch` on `detectedLanguages`

## 6. Frontend — SetupView "Configure LSP" Button

- [x] 6.1 Add `workspaceKey` (from `workspaceStore.activeWorkspaceKey`) and `dismissOnly=true` props when rendering `LspSetupPrompt` in `SetupView.vue`
- [x] 6.2 Add `@done="onLspPromptDone"` handler to the existing `LspSetupPrompt` binding in `SetupView.vue`
- [x] 6.3 Add a "Configure LSP" icon button (`pi-cog`) to each project row in `SetupView.vue`, alongside existing edit/delete actions
- [x] 6.4 Implement click handler that calls `lsp.detectLanguages({ projectPath: project.projectPath.absolute })`, stores result in `lspLanguages`, and sets `showLspPrompt = true`
- [x] 6.5 Pass `workspaceKey` (active workspace key) to the existing new-project `LspSetupPrompt` invocation in `SetupView.vue`

## 7. DI Seams (enables testing, zero production behavioral change)

- [x] 7.1 Add optional `managerFactory` constructor parameter to `TaskLSPRegistry` in `src/bun/lsp/task-registry.ts`: `(configs: LspServerConfig[], path: string) => LSPServerManager`, defaulting to `(c, p) => new LSPServerManager(c, p)`
- [x] 7.2 Add optional `registry` and `installer` parameters to `lspHandlers()` in `src/bun/handlers/lsp.ts`, defaulting to `taskLspRegistry` and imported `runInstall`
- [x] 7.3 Add `extraWorkspaces?: { key: string; yaml: string }[]` parameter to `setupTestConfig()` in `src/bun/test/helpers.ts`; write each as `workspace.<key>.yaml` in the config dir
