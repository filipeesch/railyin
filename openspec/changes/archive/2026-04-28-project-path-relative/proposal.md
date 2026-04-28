## Why

Project paths in `workspace.yaml` are currently stored as absolute filesystem paths, making configurations non-portable across machines, users, and CI environments. Enforcing workspace-relative paths for `project_path` and `git_root_path` makes configs portable and aligns with the natural expectation that a workspace's projects live inside its workspace folder.

## What Changes

- **BREAKING** `project_path` in `workspace.yaml` must now be a relative path (relative to `workspace_path`); absolute paths are rejected at config load time with a clear error and migration hint
- **BREAKING** `git_root_path` in `workspace.yaml` must now be a relative path when explicitly set; omitting it remains valid (defaults to `project_path`)
- `workspace_path` is now required whenever projects are defined; missing `workspace_path` with relative project paths produces a config error
- Backend normalizes absolute paths to relative when registering or updating projects (folder-browse input is converted automatically)
- Backend validates that a registered project path exists on disk and lives inside `workspace_path`
- A `getEffectiveWorkspacePath(config)` helper extracts the repeated `workspace_path ?? configDir` pattern used in 4 call sites
- A `path-utils.ts` module provides `resolveConfigPath` (relative → absolute at load time) and `toWorkspaceRelativePath` (absolute → relative for writes)
- `project.subPath` is pre-computed at config load (`relative(gitRootPath, projectPath)`), simplifying `WorkingDirectoryResolver`
- `workspace_path` is exposed in `WorkspaceConfig` RPC response and is editable in the Workspace settings tab of the Setup view
- `config/workspace.yaml.sample` is updated to show relative paths and `workspace_path` as a prominent required field
- Dead code: `subrepo_path` column selected in `task_git_context` query but never used is removed

## Capabilities

### New Capabilities

*(none — all changes are requirement updates to existing capabilities)*

### Modified Capabilities

- `project`: Path storage rules change — `project_path` and `git_root_path` must be relative to `workspace_path`; `workspace_path` becomes a prerequisite for project registration; projects must reside inside the workspace folder
- `project-management`: UI registration and edit flow changes — backend normalizes absolute browse paths to relative, validates containment inside workspace, inline validation requires `workspace_path` to be set before projects can be added or edited
- `workspace-management`: `workspace_path` becomes an editable field in the Workspace settings tab of the Setup view; `WorkspaceConfig` RPC response exposes `workspacePath`

## Impact

- **Config loading** (`src/bun/config/index.ts`): validation guards, path resolution, `subPath` pre-computation on `LoadedProject`
- **New utility** (`src/bun/config/path-utils.ts`): `resolveConfigPath`, `toWorkspaceRelativePath`, `getEffectiveWorkspacePath`
- **Project store** (`src/bun/project-store.ts`): normalize and validate paths on `registerProject` / `updateProject`; new `getLoadedProjectByKey()` function returning `LoadedProject | null` for internal callers
- **Working directory resolver** (`src/bun/engine/execution/working-directory-resolver.ts`): simplified — uses `project.subPath` directly; switches to `getLoadedProjectByKey`
- **4 call sites** (orchestrator, chat-executor, workspace handler, lsp handler): replace inline `workspace_path ?? configDir` with `getEffectiveWorkspacePath(config)`
- **Engine / executor internal callers** (~10 sites): replace `getProjectByKey` with `getLoadedProjectByKey` to receive `LoadedProject` (absolute strings) instead of `Project` (structured RPC type)
- **RPC contract** (`src/shared/rpc-types.ts`): `WorkspaceConfig` gains `workspacePath: string`; `Project.projectPath` and `Project.gitRootPath` change from `string` to `{ absolute: string; relative: string }`
- **Workspace handler** (`src/bun/handlers/workspace.ts`): expose `workspacePath` in `getConfig`; add `workspace_path` support to `update`
- **`toProject()` in project-store** (`src/bun/project-store.ts`): constructs structured `{ absolute, relative }` shape at the RPC boundary; used only by `getProjectByKey()`
- **Frontend store** (`src/mainview/stores/workspace.ts`): pass `workspacePath` through `update`
- **Project dialog** (`src/mainview/components/ProjectDetailDialog.vue`): access `.absolute` for FS operations, `.relative` for display; show inline warning when `workspacePath` not set
- **Setup view** (`src/mainview/views/SetupView.vue`): add `workspace_path` field (with browse button) to Workspace settings tab; display `project.projectPath.relative` in project list; use `.absolute` for `lsp.detectLanguages`
- **Config sample** (`config/workspace.yaml.sample`): show `workspace_path` prominently, all project paths as relative, add migration comment
- **DB cleanup** (`src/bun/git/worktree.ts`): remove unused `subrepo_path` column from query
