## Context

The `project-path-relative` feature changes how paths are stored in `workspace.yaml`, introduces new config validation at load time, adds a project registration normalization pipeline, and extends the UI with workspace path editing and inline project dialog validation.

Currently there is no test coverage for any of these new behaviors. The existing `setupTestConfig` helper in `src/bun/test/helpers.ts` writes absolute `project_path` values — which the new feature will actively reject — making it a blocking migration dependency.

The test suite must be designed with two constraints in mind:
1. The `helpers.ts` migration is atomic with the feature: it cannot land before the feature or every existing backend test breaks
2. New test files can be written and reviewed independently, but only pass after the feature is also present

## Goals / Non-Goals

**Goals:**
- Full unit coverage of the three path utility functions (`resolveConfigPath`, `toWorkspaceRelativePath`, `getEffectiveWorkspacePath`)
- Integration coverage of config validation at `loadConfig()` time (validation order, error messages, happy path)
- Integration coverage of the project registration normalization pipeline in `project-store.ts` (containment check, YAML write, error cases)
- Updated `WorkingDirectoryResolver` tests to cover `subPath=""` (standalone) and `subPath="packages/ui"` (monorepo) with the new load-time pre-computation
- `workspace-handlers` tests updated to cover `workspacePath` in `getConfig` response and `update` persisting `workspace_path`
- Playwright tests for the new workspace path field in SetupView and the inline validation warning in `ProjectDetailDialog`
- Mock data factories updated to match the new structured path shape

**Non-Goals:**
- Testing migration error messages exhaustively (one representative case is enough)
- E2E filesystem round-trip tests (out of scope; integration tests cover YAML round-trip)
- Performance or load tests

## Decisions

### Decision 1: `setupTestConfig` migration strategy

The helper creates a temp `configDir` and writes a YAML config. After the feature, `project_path` in YAML must be relative and `workspace_path` must be set.

**Chosen**: Create a real subdirectory `${configDir}/workspace/test-project/` using `mkdirSync`, write `workspace_path: "${configDir}/workspace"` and `project_path: test-project` in YAML. Return `{ configDir, workspacePath, cleanup }` — `workspacePath` is needed by new tests that assert path resolution.

**Why**: No call-site changes needed — all ~20 existing tests pass `workspacePath` through to the engine via `task_git_context` DB rows, not via config resolution. Adding `workspacePath` to the return type is additive and non-breaking for existing callers.

---

### Decision 2: `setupMonorepoConfig` migration

Currently a local function in `working-directory-resolver.test.ts` that writes absolute paths directly.

**Chosen**: Migrate to call `setupTestConfig` with a `workspacePath`-aware extra YAML block that sets `git_root_path` relative to the workspace. Remove the local function.

**Why**: Unifies test infrastructure. The monorepo scenario is `git_root_path` being one level above `project_path` — after the migration both are relative to the same `workspacePath`, which `setupTestConfig` now owns.

---

### Decision 3: Real filesystem for `project-registration-paths` tests

`existsSync` is called in the normalization pipeline to validate that the path being registered actually exists.

**Chosen**: Use real `mkdtempSync` directories — no filesystem abstraction. Tests create real temp dirs, register them, and assert the YAML is written with relative values.

**Why**: A filesystem mock would hide real OS behavior (symlinks, case sensitivity on macOS, permissions). The test creates and cleans up directories it owns, so there is no shared-state risk.

---

### Decision 4: New test file locations and naming

| New file | What it tests |
|----------|--------------|
| `src/bun/test/path-utils.test.ts` | `resolveConfigPath`, `toWorkspaceRelativePath`, `getEffectiveWorkspacePath` (pure unit) |
| `src/bun/test/config-path-validation.test.ts` | `loadConfig()` validation: missing workspace_path, absolute path rejection, relative path resolution, subPath computation |
| `src/bun/test/project-registration-paths.test.ts` | `registerProject` / `updateProject` normalization: containment check, YAML round-trip, missing workspace_path error |

**Why separate files**: each tests a distinct module boundary; combining them would create mixed-concern test files.

---

### Decision 5: "outside gitRootPath" test migration

Currently in `working-directory-resolver.test.ts` as a runtime throw test. After the feature, this validation happens at registration time in `project-store.ts`.

**Chosen**: Remove it from `working-directory-resolver.test.ts` and add equivalent coverage in `project-registration-paths.test.ts`.

**Why**: The test should live at the layer where the validation actually happens. Keeping it in WDR would test dead code paths.

---

### Decision 6: Playwright mock data shape

`makeProject()` in `e2e/ui/fixtures/mock-data.ts` returns flat `projectPath: string`. After the change, `Project.projectPath` is `{ absolute: string; relative: string }`.

**Chosen**: Update `makeProject()` to use the structured shape, add `workspacePath: "/home/user/projects"` to `makeWorkspace()`, and add `makeWorkspaceNoPath()` for tests that need to exercise the "no workspace_path set" warning state.

**Why**: All Playwright tests use these factories. Centralizing the shape change here avoids duplicated object literals in each spec file.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `helpers.ts` migration must be atomic with feature | Co-commit in tasks.md; cannot be independent PR |
| Playwright tests depend on mock-data shape change | Mock-data update is a prerequisite task in tasks.md |
| `working-directory-resolver.test.ts` loses the "outside gitRootPath" test temporarily if tests land before feature | Keep test in WDR until feature lands, then move in the same commit |
