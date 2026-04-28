## 1. Path Utilities Module

- [x] 1.1 Create `src/bun/config/path-utils.ts` with `resolveConfigPath(base, relativePath): string`, `toWorkspaceRelativePath(workspacePath, absolutePath): string`, and `getEffectiveWorkspacePath(config): string` exports
- [x] 1.2 Add unit-level inline assertions (no test file yet) verifying each utility handles edge cases: empty subPath, root-equals-project, trailing slashes

## 2. Config Loading — Validation and Resolution

- [x] 2.1 Add `isAbsolute`, `resolve`, `relative` to imports in `src/bun/config/index.ts`
- [x] 2.2 Add `subPath: string` field to `LoadedProject` interface
- [x] 2.3 Add pre-project-mapping validation guard: if workspace has projects and `workspace_path` is not set, return config error "workspace_path is required when projects are defined"
- [x] 2.4 In the project mapping block (lines 561–576), add `isAbsolute` guard for `project_path` — return config error with migration hint if absolute
- [x] 2.5 Resolve `projectPath = resolveConfigPath(workspacePath, project.project_path)` in project mapping
- [x] 2.6 Add `isAbsolute` guard for `git_root_path` when explicitly set — return config error with migration hint
- [x] 2.7 Resolve `gitRootPath` when set, otherwise default to `projectPath` (unchanged logic)
- [x] 2.8 Compute and assign `subPath = relative(gitRootPath, projectPath)` on `LoadedProject`

## 3. Call-Site Cleanup — getEffectiveWorkspacePath

- [x] 3.1 Replace `config.workspace.workspace_path ?? config.configDir` in `src/bun/engine/orchestrator.ts` with `getEffectiveWorkspacePath(config)`
- [x] 3.2 Replace same pattern in `src/bun/engine/execution/chat-executor.ts`
- [x] 3.3 Replace same pattern in `src/bun/handlers/workspace.ts`
- [x] 3.4 Replace same pattern in `src/bun/handlers/lsp.ts`

## 4. Project Store — Normalization and Validation

- [x] 4.1 In `registerProject` (`src/bun/project-store.ts`): resolve `workspacePath` via `getEffectiveWorkspacePath`, error if not set
- [x] 4.2 In `registerProject`: validate given path exists on disk (`existsSync`), error if not
- [x] 4.3 In `registerProject`: validate path is inside `workspacePath` (`!relative(...).startsWith("..")`), error if not
- [x] 4.4 In `registerProject`: convert to relative with `toWorkspaceRelativePath` before writing to YAML
- [x] 4.5 Apply the same normalization and validation logic to `updateProject`
- [x] 4.6 Apply same to `git_root_path` field when provided in register/update

## 5. Working Directory Resolver Simplification

- [x] 5.1 Update `src/bun/engine/execution/working-directory-resolver.ts` to use `project.subPath` directly: `join(worktreePath, project.subPath)` — remove runtime `relative()` call and `".."` guard
- [x] 5.2 Update `src/bun/test/working-directory-resolver.test.ts` mock fixtures to include `subPath` on `LoadedProject` test objects

## 6. RPC Contract — Structured Path Type

- [x] 6.1 Add `workspacePath: string` to `WorkspaceConfig` interface in `src/shared/rpc-types.ts`
- [x] 6.2 Add `workspacePath?: string` to `workspace.update` params in `src/shared/rpc-types.ts`
- [x] 6.3 Change `Project.projectPath` from `string` to `{ absolute: string; relative: string }` in `src/shared/rpc-types.ts`
- [x] 6.4 Change `Project.gitRootPath` from `string` to `{ absolute: string; relative: string }` in `src/shared/rpc-types.ts`

## 7. Project Store — `toProject()` and `getLoadedProjectByKey()`

- [x] 7.1 Update `toProject()` in `src/bun/project-store.ts` to accept `workspacePath: string` and return `projectPath: { absolute, relative }` and `gitRootPath: { absolute, relative }` using `toWorkspaceRelativePath`
- [x] 7.2 Add `getLoadedProjectByKey(key: string, config: LoadedConfig): LoadedProject | null` to `src/bun/project-store.ts` — returns internal type with absolute string paths
- [x] 7.3 Restrict `getProjectByKey()` to return `Project` (RPC type); only `handlers/projects.ts` should call it

## 8. Engine / Executor — Migrate to `getLoadedProjectByKey()`

- [x] 8.1 In `src/bun/engine/orchestrator.ts`: replace `getProjectByKey` with `getLoadedProjectByKey`
- [x] 8.2 In `src/bun/engine/execution/chat-executor.ts`: replace `getProjectByKey` with `getLoadedProjectByKey`
- [x] 8.3 In `src/bun/engine/execution/working-directory-resolver.ts`: replace `getProjectByKey` with `getLoadedProjectByKey`
- [x] 8.4 In `src/bun/handlers/lsp.ts`: replace `getProjectByKey` with `getLoadedProjectByKey`
- [x] 8.5 In `src/bun/handlers/tasks.ts` (if applicable): replace `getProjectByKey` with `getLoadedProjectByKey`
- [x] 8.6 In `src/bun/engine/board-tools.ts` (if applicable): replace `getProjectByKey` with `getLoadedProjectByKey`
- [x] 8.7 In `src/bun/handlers/launch.ts` (if applicable): replace `getProjectByKey` with `getLoadedProjectByKey`

## 9. Backend Handler — workspace.ts

- [x] 9.1 In `workspace.getConfig` handler: include `workspacePath: getEffectiveWorkspacePath(config)` in the response
- [x] 9.2 In `workspace.update` handler: accept `workspacePath` param and write `workspace_path` to YAML via `patchWorkspaceYaml`

## 10. Frontend Store

- [x] 10.1 Add `workspacePath?: string` to `update()` params in `src/mainview/stores/workspace.ts` and pass through to `workspace.update` RPC call

## 11. Setup View — Workspace Path Field

- [x] 11.1 Add `workspacePath: ""` to `wsForm` reactive object in `SetupView.vue`
- [x] 11.2 Add `wsForm.workspacePath = cfg.workspacePath ?? ""` in `syncWsForm()`
- [x] 11.3 Add `workspacePath: wsForm.workspacePath || undefined` to `saveWorkspaceSettings()` call
- [x] 11.4 Add workspace path field in the Workspace tab template (after name, before engine): InputText + browse button (reuse `workspace.openFolderDialog`), label "Workspace path", hint "Root folder containing all your projects (required to register projects)"
- [x] 11.5 Add `browsingWorkspacePath` ref and `browseWorkspacePath()` function (mirrors `browseWorktreePath`)

## 12. Project Dialog — Inline Validation and Path Display

- [x] 12.1 In `ProjectDetailDialog.vue`: read `workspaceStore.config?.workspacePath` and show inline warning when not set ("workspace_path must be configured in Workspace settings before registering projects")
- [x] 12.2 Disable save button when `workspacePath` is not set
- [x] 12.3 Update path input placeholder/hint text from "absolute path to the project folder" to "path relative to workspace path (e.g. packages/ui)"
- [x] 12.4 Use `form.projectPath.absolute` (not `.relative`) when passing to FS/RPC operations inside the dialog
- [x] 12.5 Display `project.projectPath.relative` in the project list in `SetupView.vue` (line ~124)
- [x] 12.6 Use `project.projectPath.absolute` when calling `lsp.detectLanguages` in `SetupView.vue` (line ~436)

## 13. Config Sample and Dead Code

- [x] 13.1 Update `config/workspace.yaml.sample`: add prominent `workspace_path` field, convert all example `project_path` / `git_root_path` values to relative, add migration comment block explaining the breaking change
- [x] 13.2 Remove unused `subrepo_path` column from `SELECT` query in `src/bun/git/worktree.ts`
