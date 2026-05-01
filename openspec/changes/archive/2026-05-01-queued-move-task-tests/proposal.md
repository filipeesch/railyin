## Why

The `queued-move-task` feature introduces non-trivial new behavior across three layers (backend, frontend store, Playwright e2e) and also modifies existing behavior in ways that break existing tests. Without a dedicated test suite, regressions in the deferred column-prompt flow, the unread dot timing, and the status badge fix cannot be caught automatically.

Additionally, the `StreamProcessor` constructor change (adding two drain callbacks) and the narrowing of `markTaskUnread` to terminal execution states both silently break existing tests that must be updated before implementation is considered complete.

## What Changes

- **Backend integration tests** across 4 existing test files — updates to constructor call sites and new test cases for three-case move logic, drain priority, badge fix, and deferred-transition handler path
- **Frontend Vitest tests** in `src/mainview/stores/task.test.ts` — new tests verifying the narrowed unread-dot trigger conditions
- **Playwright e2e tests** — 3 existing `board-unread.spec.ts` tests updated to the new trigger mechanism, 3 new unread tests, and new deferred-prompt tests covering drag-and-drop and task drawer paths

## Capabilities

### New Capabilities
- `queued-move-task-test-suite`: end-to-end test coverage for the queued-move-task feature — backend integration, frontend unit, and Playwright e2e

### Modified Capabilities
None — this change adds tests only; no production code requirements change.

## Impact

- **Test files modified**: `src/bun/test/stream-processor.test.ts`, `src/bun/test/transition-executor.test.ts`, `src/bun/test/tasks-tools.test.ts`, `src/bun/test/handlers.test.ts`, `src/mainview/stores/task.test.ts`, `e2e/ui/board-unread.spec.ts`
- **Test files created**: possibly `e2e/ui/queued-column-prompt.spec.ts` for deferred-prompt e2e scenarios
- **No production code changes** — depends on `queued-move-task` being implemented first
- **Requires** `queued-move-task` change to be applied before this test suite is run
