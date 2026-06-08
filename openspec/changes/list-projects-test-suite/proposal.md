## Why

The `list_projects` feature (change: `list-projects-tool`) introduces new code paths that require comprehensive test coverage: a new tool handler, DI injection via `IProjectRepository`, auto-derived `COMMON_TOOL_NAMES`, and auto-derived `CHILD_COMMON_TOOL_NAMES` via `childAllowed` flag. Without tests, regressions in any of these areas would go undetected.

## What Changes

- Add unit tests for `list_projects` registration, display label, and execution with mocked `IProjectRepository`
- Add integration tests using `setupTestConfig()` with real workspace config and `ConfigProjectRepository`
- Add tests for auto-derived `COMMON_TOOL_NAMES` (no manual names)
- Add tests for auto-derived `CHILD_COMMON_TOOL_NAMES` via `childAllowed` flag
- Update existing test files to inject the new `repos.projects` mock into `CommonToolContext`

## Capabilities

### New Capabilities
- `list-projects-test-suite`: Comprehensive test coverage for the `list_projects` tool including unit tests (mocked), integration tests (real config), and cleanup tests (auto-derived names, childAllowed flag).

### Modified Capabilities
- `engine-common-tools`: Tests verify the `engine-common-tools` delta spec requirements (DI injection, auto-derived names, childAllowed flag).

## Impact

- `src/bun/test/common-tools-registration.test.ts` — add list_projects tests + projects mock
- `src/bun/test/workspace-tools.test.ts` — new integration test file
- `src/bun/test/note-tools.test.ts` — add projects mock
- `src/bun/test/tasks-tools.test.ts` — add projects mock
- `src/bun/test/column-groups.test.ts` — add projects mock
- `src/bun/test/pi-common-tools-bridge.test.ts` — add projects mock
- No production code changes — tests only
