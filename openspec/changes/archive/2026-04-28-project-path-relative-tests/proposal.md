## Why

The `project-path-relative` feature introduces new behavior across three layers — config loading, project registration, and the SetupView UI. None of this behavior has automated test coverage yet. This change adds the full test suite: unit tests for the new path utilities, integration tests for config validation and project registration normalization, updates to the shared `setupTestConfig` helper (which currently writes absolute paths that the new feature will reject), and new Playwright tests for the UI changes (workspace path field, project dialog inline validation).

The test suite is a separate change because it crosses multiple test layers with distinct concerns, and to allow the tests to be reviewed and iterated independently of the feature implementation.

## What Changes

- `src/bun/test/helpers.ts`: `setupTestConfig` migrated to create a real `workspacePath` directory inside the temp `configDir`, write `workspace_path` in YAML, and write relative `project_path`. Returns `workspacePath` in its result. All ~20 existing backend tests continue working without call-site changes.
- `src/bun/test/path-utils.test.ts`: new unit tests for `resolveConfigPath`, `toWorkspaceRelativePath`, `getEffectiveWorkspacePath`
- `src/bun/test/config-path-validation.test.ts`: new integration tests for config load validation — rejects absolute paths, rejects missing `workspace_path`, resolves relative paths correctly, computes `subPath`
- `src/bun/test/project-registration-paths.test.ts`: new integration tests for project-store normalization pipeline — real `mkdtempSync` dirs, containment check, YAML round-trip
- `src/bun/test/working-directory-resolver.test.ts`: `setupMonorepoConfig` migrated to use `setupTestConfig` with `workspacePath` param; "outside gitRootPath" test scenario moved to `config-path-validation.test.ts`; `subPath=""` and `subPath="packages/ui"` cases added
- `src/bun/test/workspace-handlers.test.ts`: one test that manually writes absolute paths in YAML updated; tests added for `getConfig` returning `workspacePath` and `update` persisting `workspace_path`
- `e2e/ui/fixtures/mock-data.ts`: `makeWorkspace()` gains `workspacePath: "/home/user/projects"`, new `makeWorkspaceNoPath()` factory for warning-state tests
- `e2e/ui/workspace-settings.spec.ts`: new tests W-6/W-7/W-8/W-9 for workspace path field (renders, saves, browse button, required), new tests P-8/P-9/P-10 for project dialog inline validation (warning when no workspace path, disabled save, hint text)

## Capabilities

### New Capabilities

*(none — this change adds tests, not new product capabilities)*

### Modified Capabilities

*(none — tests only)*

## Impact

- **Test infrastructure** (`src/bun/test/helpers.ts`): breaking internal migration — must land in the same commit as the feature or all backend tests will fail
- **3 new backend test files**: pure additions, no existing file changes
- **2 updated backend test files**: `working-directory-resolver.test.ts`, `workspace-handlers.test.ts`
- **2 updated UI test files/fixtures**: `mock-data.ts`, `workspace-settings.spec.ts`
- **No production code changes**: this change is tests-only
