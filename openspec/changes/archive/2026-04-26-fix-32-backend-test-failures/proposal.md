## Why

Running `bun test src/bun/test --timeout 20000` produces 32 failures across three test files. All failures are regressions introduced on `main` after the backend test suite was last green — they are NOT pre-existing flakiness. They need to be fixed so CI is reliable and developers get a trustworthy test signal.

## What Changes

- **Fix `db-migrations.test.ts` (2 tests)**: Update stale test fixtures that don't include tables/columns added by migrations `030` and `031`, which were introduced after the fixtures were last updated.
- **Fix `tasks-tools.test.ts` (8 tests)**: Update todo tool tests (`create_todo`, `edit_todo`, `list_todos`) to unwrap the new `ToolExecutionResult` return type (`result.text`) instead of treating the return value as a plain string.
- **Fix `copilot-rpc-scenarios.test.ts` and `claude-rpc-scenarios.test.ts` (~22 tests)**: Replace calls to `waitForTokenDone()` in `shared-rpc-scenarios.ts` with `waitForStreamDone()`, which aligns with the event channel that is actually wired up after the streaming pipeline refactor.

## Capabilities

### New Capabilities

- `backend-test-suite-green`: The backend test suite passes completely with `bun test src/bun/test --timeout 20000`, providing a reliable CI signal.

### Modified Capabilities

- `engine-common-tools`: The `executeCommonTool` function return type changed to `ToolExecutionResult` (union of `{ type: "result", text }` and `{ type: "suspend", payload }`). Test expectations must unwrap `.text` before parsing JSON.

## Impact

- `src/bun/test/db-migrations.test.ts` — fixture schemas updated
- `src/bun/test/tasks-tools.test.ts` — 8 test assertions updated
- `src/bun/test/support/shared-rpc-scenarios.ts` — `waitForTokenDone` replaced with `waitForStreamDone`
- No production code changes required
- No API or dependency changes
