## 1. Test Infrastructure Migration (atomic with feature)

- [x] 1.1 Migrate `setupTestConfig` in `src/bun/test/helpers.ts`: use `mkdirSync` to create `${configDir}/workspace/test-project/`, write YAML with `workspace_path: "${configDir}/workspace"` and `project_path: test-project`, return `{ configDir, workspacePath, cleanup }` (additive — existing destructuring of `{ configDir, cleanup }` is unaffected)
- [x] 1.2 Verify all ~20 existing backend test files still pass without call-site changes after the helper migration

## 2. `setupMonorepoConfig` Migration

- [x] 2.1 In `src/bun/test/working-directory-resolver.test.ts`, replace the local `setupMonorepoConfig` function with a call to `setupTestConfig` that passes extra YAML for `git_root_path` (relative to `workspacePath`), creating the monorepo subdirectory structure using real `mkdirSync` calls
- [x] 2.2 Remove the old local `setupMonorepoConfig` function after migration

## 3. New Unit Tests: `path-utils.test.ts`

- [x] 3.1 Create `src/bun/test/path-utils.test.ts`
- [x] 3.2 Add unit tests for `resolveConfigPath`: resolves relative path against base, handles already-absolute paths, handles empty relative path
- [x] 3.3 Add unit tests for `toWorkspaceRelativePath`: absolute-to-relative conversion, path inside workspace, path equal to workspace root
- [x] 3.4 Add unit tests for `getEffectiveWorkspacePath`: returns `workspace_path` when set, falls back to `configDir` when not set

## 4. New Integration Tests: `config-path-validation.test.ts`

- [x] 4.1 Create `src/bun/test/config-path-validation.test.ts`
- [x] 4.2 Add test: `loadConfig()` returns error when projects exist but `workspace_path` is not set
- [x] 4.3 Add test: `loadConfig()` returns error when `project_path` is absolute (includes migration hint in message)
- [x] 4.4 Add test: `loadConfig()` returns error when `git_root_path` is absolute
- [x] 4.5 Add test: `loadConfig()` succeeds with valid relative `project_path` and resolves to correct absolute path
- [x] 4.6 Add test: `loadConfig()` computes `subPath = ""` for standalone repo (project_path === git_root_path)
- [x] 4.7 Add test: `loadConfig()` computes `subPath = "packages/ui"` for monorepo (git_root_path is parent of project_path)
- [x] 4.8 Move the "throws when projectPath is outside gitRootPath" scenario from `working-directory-resolver.test.ts` to this file (now validated at config-load time)

## 5. New Integration Tests: `project-registration-paths.test.ts`

- [x] 5.1 Create `src/bun/test/project-registration-paths.test.ts` using real `mkdtempSync` workspace and project directories
- [x] 5.2 Add test: `registerProject` with absolute path inside workspace → succeeds, YAML stores relative path
- [x] 5.3 Add test: `registerProject` with absolute path outside workspace → throws containment error
- [x] 5.4 Add test: `registerProject` with non-existent path → throws `existsSync` error
- [x] 5.5 Add test: `registerProject` when `workspace_path` not set → throws "workspace_path must be set" error
- [x] 5.6 Add test: `updateProject` normalizes absolute path to relative (same containment rules)
- [x] 5.7 Add test: YAML round-trip — register project with absolute path, reload YAML, confirm `project_path` is stored as relative string

## 6. Updated `working-directory-resolver.test.ts`

- [x] 6.1 Remove the "throws when projectPath is outside gitRootPath" test (moved to `config-path-validation.test.ts`)
- [x] 6.2 Add test: WDR resolves CWD correctly when `project.subPath = ""` (standalone repo: cwd = worktreePath)
- [x] 6.3 Add test: WDR resolves CWD correctly when `project.subPath = "packages/ui"` (monorepo: cwd = join(worktreePath, "packages/ui"))
- [x] 6.4 Confirm no call to `path.relative()` exists in WDR after the feature (dead code removed)

## 7. Updated `workspace-handlers.test.ts`

- [x] 7.1 Fix the test at lines ~55–70 that writes `project_path: /tmp/test-git` (absolute) — update to use `workspace_path` + relative `project_path`
- [x] 7.2 Add test: `workspace.getConfig` response includes `workspacePath` field set to the resolved workspace path
- [x] 7.3 Add test: `workspace.update` with `workspacePath` param writes `workspace_path` to YAML and the new value is returned on next `getConfig`

## 8. Mock Data Updates (`e2e/ui/fixtures/mock-data.ts`)

- [x] 8.1 Update `makeProject()` to use structured `projectPath: { absolute: string; relative: string }` and `gitRootPath: { absolute: string; relative: string }` — default values: `{ absolute: "/home/user/projects/test", relative: "test" }`
- [x] 8.2 Add `workspacePath: "/home/user/projects"` to `makeWorkspace()` factory
- [x] 8.3 Add `makeWorkspaceNoPath()` factory that returns a workspace with `workspacePath` omitted (for UI warning state tests)

## 9. Playwright Tests: Workspace Path Field (workspace-settings.spec.ts)

- [x] 9.1 Add test W-6: Workspace tab renders `workspace_path` input field
- [x] 9.2 Add test W-7: Saving workspace with new `workspace_path` value persists and shows success state
- [x] 9.3 Add test W-8: Workspace tab has a browse button for `workspace_path` that triggers folder dialog
- [x] 9.4 Add test W-9: `workspace_path` field is required — save button disabled when empty

## 10. Playwright Tests: Project Dialog Inline Validation (workspace-settings.spec.ts)

- [x] 10.1 Add test P-8: `ProjectDetailDialog` shows inline warning banner when `workspacePath` is not set on the workspace
- [x] 10.2 Add test P-9: Save button in `ProjectDetailDialog` is disabled when `workspacePath` is not set
- [x] 10.3 Add test P-10: `ProjectDetailDialog` shows hint text "Path will be stored relative to [workspace path]" when `workspacePath` is set

## 11. Validation and Cleanup

- [x] 11.1 Run full backend test suite (`bun test src/bun/test --timeout 20000`) and confirm no regressions
- [x] 11.2 Run Playwright workspace-settings suite and confirm all new + existing tests pass
- [x] 11.3 Confirm `subrepo_path` dead column reference is removed from `src/bun/git/worktree.ts` (cleanup task noted in feature change)
