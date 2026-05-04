## Context

The LSP subsystem in Railyn manages language server processes per-task, using workspace-level configuration in `workspace.yaml` under `lsp.servers`. There are four independent bugs, all stemming from the same root cause: the workspace key is not propagated through the LSP subsystem.

**Current broken paths:**
1. `lsp.addToConfig` / `lsp.runInstall` handlers call `getConfigDir()` with no args → always write to default workspace
2. `CopilotEngine` and `ClaudeEngine` call `getConfig()` with no args → always read LSP servers from default workspace
3. `TaskLSPRegistry.getManager()` never detects worktree path changes → returns stale LSP managers
4. `lsp.workspaceSymbol` falls back to `process.cwd()` → wrong root for worktree-less tasks
5. `SetupView` has no "Configure LSP" entry for existing projects → users must re-register to fix LSP

**Existing infrastructure that already works correctly:**
- `getConfigDir(workspaceKey?)` accepts an optional workspace key — just never receives one
- `getBoardWorkspaceKey(boardId)` and `getTaskWorkspaceKey(taskId)` exist in `workspace-context.ts`
- `ExecutionParams` already flows from orchestrator → builder → engine; it's the natural carrier for `workspaceKey`
- `getProjectByKey(workspaceKey, projectKey)` provides the fallback path

## Goals / Non-Goals

**Goals:**
- LSP config writes (`addToConfig`, `runInstall`) target the correct workspace
- Task executions boot LSP servers using the correct workspace's server list
- Stale worktree paths in `TaskLSPRegistry` are detected and corrected automatically
- `lsp.workspaceSymbol` uses a meaningful fallback path (project path) instead of `process.cwd()`
- Existing projects can trigger LSP detection/setup from the project list in SetupView
- `LspSetupPrompt` carries workspace context so all downstream LSP calls are workspace-scoped

**Non-Goals:**
- LSP configuration is NOT per-project (intentional design: one server config per workspace covers all projects)
- No changes to how LSP servers are started/stopped (LSPServerManager internals unchanged)
- No test additions in this change (addressed separately)
- No changes to the LSP detection algorithm itself

## Decisions

### Decision: Thread `workspaceKey` through `ExecutionParams`

`ExecutionParams` already flows from orchestrator → `ExecutionParamsBuilder` → engines. Adding `workspaceKey: string` here avoids any new DB lookups inside engines. The orchestrator already calls `getBoardWorkspaceKey(task.board_id)`.

**Alternatives considered:**
- Engines call `getTaskWorkspaceKey(taskId)` directly: adds async DB lookup per execution, tightly couples engine to DB layer
- Pass via `CommonToolContext`: `workspaceKey` is needed before tools are initialized (during LSP manager setup), so tool context is too late

### Decision: `workspaceKey` as explicit param in `lsp.addToConfig` / `lsp.runInstall` RPC

The frontend (SetupView / LspSetupPrompt) already knows which workspace is active via `workspaceStore.activeWorkspaceKey`. Making it an explicit param matches the pattern of other workspace-scoped RPC calls and avoids server-side inference from project path.

**Alternatives considered:**
- Infer workspace from `projectPath`: requires reverse-lookup across all workspaces' configs, fragile if project is in multiple workspaces
- Use a session/header: no session concept in the current RPC transport

### Decision: Detect stale path in `TaskLSPRegistry`, recreate manager on mismatch

`TaskLSPRegistry.getManager()` receives both `scopeId` and `worktreePath`. If the cached entry has a different path, shut down the old manager and create a new one. This is defensive and correct: a task's worktree path can change after worktree setup (or if the task is reset).

**Alternatives considered:**
- Always recreate: wasteful; most calls are repeated calls for the same running task
- Error on mismatch: would break task execution for legitimate re-setup scenarios

### Decision: `lsp.workspaceSymbol` falls back to project `projectPath.absolute`

When `worktree_path` is null the LSP manager needs a meaningful root. The task's project path is the correct semantic fallback: it's where the source code lives. The handler already has `task.board_id` → `getBoardWorkspaceKey` → `getProjectByKey` to resolve it.

**Alternatives considered:**
- Keep `process.cwd()`: incorrect, always points at the server process working directory
- Return empty results: silently wrong, harder to debug

### Decision: "Configure LSP" button in project list row (icon button)

Matches the existing edit/delete pattern in SetupView. An icon button (`pi-server`) is unobtrusive, discoverable, and consistent. Reuses existing `lspLanguages` + `showLspPrompt` refs already present in SetupView.

**Alternatives considered:**
- Menu item inside project dropdown: adds an extra click, less discoverable
- Separate settings tab per project: over-engineered for a single action
- Trigger automatically on project load: would be intrusive for workspaces where LSP is intentionally not configured

### Decision: `LspSetupPrompt` receives `dismissOnly` prop for existing projects

When triggered from the project list (not during first registration), the `done` handler should close the prompt without redirecting to Boards. A `dismissOnly: boolean` prop avoids duplicating the component or adding complex routing logic.

## Risks / Trade-offs

- **[Risk] Breaking change in RPC params** → Both `lsp.addToConfig` and `lsp.runInstall` add a required `workspaceKey` param. Any caller not updated will get a type error at compile time (TypeScript contract enforced). Mitigation: update both callers (`LspSetupPrompt.vue`) in the same commit.

- **[Risk] `ExecutionParams.workspaceKey` defaulting** → If a board somehow lacks a workspace key (shouldn't happen in practice), engines would fall back to default config silently. Mitigation: `getBoardWorkspaceKey` already throws or returns a well-known default; document the behavior.

- **[Trade-off] LSP config is workspace-scoped, not project-scoped** → A user clicking "Configure LSP" on a project configures servers for the entire workspace. This is intentional (the current design) but could be surprising. Mitigation: the UI label and prompt should make this clear ("Configure language servers for this workspace").

## Migration Plan

No data migrations required. All changes are in-process (config reads/writes and in-memory registries).

1. Update `rpc-types.ts` (param types)
2. Update backend handlers (`lsp.ts`, `task-registry.ts`)
3. Update execution engine path (`types.ts`, `execution-params-builder.ts`, `orchestrator.ts`, `copilot/engine.ts`, `claude/engine.ts`)
4. Update frontend (`LspSetupPrompt.vue`, `SetupView.vue`)
5. Remove `@deprecated` annotation from `WorkspaceYaml.lsp`

No rollback strategy needed — all changes are additive or are bug fixes with no state mutations.

## Open Questions

None — all design decisions have been resolved with user input.
