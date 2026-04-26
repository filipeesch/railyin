## 1. Shared Types

- [x] 1.1 Add `engine: { type: "copilot" | "claude"; model?: string }` field to `WorkspaceConfig` interface in `src/shared/rpc-types.ts`
- [x] 1.2 Add `workspace.create` RPC signature: `{ name: string } → WorkspaceSummary`
- [x] 1.3 Add `workspace.update` RPC signature: `{ workspaceKey?: string; name?: string; engineType?: string; engineModel?: string; worktreeBasePath?: string } → Record<string, never>`
- [x] 1.4 Add `workspace.resolveGitRoot` RPC signature: `{ path: string } → { gitRoot: string | null }`
- [x] 1.5 Add `projects.update` RPC signature: `{ workspaceKey: string; key: string; name?: string; projectPath?: string; gitRootPath?: string; defaultBranch?: string; slug?: string; description?: string } → Project`
- [x] 1.6 Add `projects.delete` RPC signature: `{ workspaceKey: string; key: string } → Record<string, never>`

## 2. Backend — Config Layer

- [x] 2.1 Fix `patchWorkspaceYaml` in `src/bun/config/index.ts` to deep-merge the `engine` block (same pattern as `anthropic`)
- [x] 2.2 Strip `git_path` and `shell_env_timeout_ms` keys from merged object before writing in `patchWorkspaceYaml`
- [x] 2.3 Export `ensureConfigExists` from `src/bun/config/index.ts` (currently private) and export `sanitizeWorkspaceKey`

## 3. Backend — New RPC Handlers

- [ ] 3.1 Implement `workspace.create` in `src/bun/handlers/workspace.ts`: sanitize name → key, check for duplicates, call `ensureConfigExists`, `resetConfig`, return new `WorkspaceSummary`
- [ ] 3.2 Implement `workspace.update` in `src/bun/handlers/workspace.ts`: call `patchWorkspaceYaml` with name/engine/worktreeBasePath fields, `clearProviderCache`, `resetConfig`
- [ ] 3.3 Implement `workspace.resolveGitRoot` in `src/bun/handlers/workspace.ts`: spawn `git -C <path> rev-parse --show-toplevel`, return `{ gitRoot }` or `{ gitRoot: null }` on error
- [ ] 3.4 Update `workspace.getConfig` response to include `engine: { type, model }` from `config.engine`
- [ ] 3.5 Implement `projects.update` in `src/bun/handlers/projects.ts`: find project by key in workspace YAML, patch fields, write back via `patchWorkspaceYaml`
- [ ] 3.6 Implement `projects.delete` in `src/bun/handlers/projects.ts`: remove project from `workspace.yaml`, then `DELETE FROM tasks WHERE project_key = ? AND board_id IN (SELECT id FROM boards WHERE workspace_key = ?)`

## 4. Frontend — Stores

- [ ] 4.1 Add `create(name: string)` method to `useWorkspaceStore` calling `workspace.create`
- [ ] 4.2 Add `update(params)` method to `useWorkspaceStore` calling `workspace.update` and refreshing config
- [ ] 4.3 Add `resolveGitRoot(path: string)` method to `useWorkspaceStore` calling `workspace.resolveGitRoot`
- [ ] 4.4 Add `updateProject(params)` method to `useProjectStore` calling `projects.update`
- [ ] 4.5 Add `deleteProject(workspaceKey, key)` method to `useProjectStore` calling `projects.delete` and removing from local list

## 5. Frontend — ProjectDetailDialog Component

- [ ] 5.1 Create `src/mainview/components/ProjectDetailDialog.vue` — PrimeVue Dialog with fields: name, project path, git root path, default branch, slug, description
- [ ] 5.2 Add "Detect git root" button next to the Git root field that calls `workspaceStore.resolveGitRoot` and auto-fills the field
- [ ] 5.3 Wire `@save` emit to call `projectStore.updateProject` (edit mode) or `projectStore.registerProject` (add mode)
- [ ] 5.4 Show inline error on save failure; show loading state on the save button

## 6. Frontend — SetupView Overhaul

- [ ] 6.1 Add a new "Workspace" tab as the first tab in `SetupView.vue` with form fields: Name (`InputText`), Engine (`Select` with copilot/claude options), Model (`Select` populated from `models.list`), Worktree Base Path (`InputText`)
- [ ] 6.2 Add "Save settings" button to Workspace tab that calls `workspaceStore.update`; show success toast and error message
- [ ] 6.3 Add "+ New workspace" button next to the workspace picker that opens a small Dialog (name input + derived key preview) and calls `workspaceStore.create`
- [ ] 6.4 Rebuild the Projects tab: show existing projects as a list (name + path + Edit/Delete buttons) above the "Add project" button
- [ ] 6.5 Wire Edit button to open `ProjectDetailDialog` pre-populated with the project's current values
- [ ] 6.6 Wire Delete button to show a PrimeVue `ConfirmDialog` with task count cascade warning, then call `projectStore.deleteProject` on confirm
- [ ] 6.7 Wire "+ Add project" to open `ProjectDetailDialog` in create mode; on save, follow existing LSP detection flow
- [ ] 6.8 Re-fetch `models.list` when engine type changes in the Workspace tab so the model dropdown updates immediately
- [ ] 6.9 Remove the "Edit `workspace.yaml`" hint text and the standalone "Reload config" button from the Workspace tab

## 7. Backend Tests

- [ ] 7.1 Add tests to `src/bun/test/workspace-handlers.test.ts` for `workspace.create` (success, duplicate key error)
- [ ] 7.2 Add tests for `workspace.update` (name, engine type, engine model, worktree path)
- [ ] 7.3 Add tests for `workspace.resolveGitRoot` (valid git path, non-git path)
- [ ] 7.4 Add tests verifying `patchWorkspaceYaml` deep-merges the `engine` block correctly
- [ ] 7.5 Add tests verifying `git_path` and `shell_env_timeout_ms` are stripped on write
- [ ] 7.6 Add tests for `projects.update` and `projects.delete` (cascade verification — tasks deleted)

## 8. Playwright E2E Tests

- [ ] 8.1 Create `e2e/ui/workspace-settings.spec.ts` with baseline mocks for all new RPCs
- [ ] 8.2 Test W1: Setup page loads with 4 tabs (Workspace, Projects, Boards, Models)
- [ ] 8.3 Test W2: Workspace name edit → save → `workspace.update` called with correct params
- [ ] 8.4 Test W3: Engine type changed to "Claude Code" → model list re-fetched → model dropdown updates
- [ ] 8.5 Test W4: "+ New workspace" dialog → type name → derived key shown → create → workspace added to picker
- [ ] 8.6 Test W5: Edit project → dialog pre-populated → save → `projects.update` called
- [ ] 8.7 Test W6: Delete project → confirm dialog shows cascade warning → `projects.delete` called → row removed
- [ ] 8.8 Test W7: "Detect git root" button → `workspace.resolveGitRoot` called → git root field auto-filled
- [ ] 8.9 Test W8: `workspace.update` returns error → error message shown, form values unchanged
