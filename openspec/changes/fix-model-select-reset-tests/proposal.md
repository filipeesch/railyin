## Why

The `fix-model-select-reset` change fixes 9 bare-query bug sites and removes a frontend workaround. Without a dedicated test suite, these fixes have no regression protection — the same pattern of missing `LEFT JOIN conversations` could silently reappear in a future PR. Tests also verify the cleanup (guard removal) doesn't regress model persistence behavior.

## What Changes

- **New test file** `src/bun/test/task-queries.test.ts` — unit tests for the new shared `fetchTaskWithModel` / `fetchChatSessionWithModel` helpers
- **New test file** `src/bun/test/task-repository.test.ts` — regression test for `TaskRepository.findById` returning correct model after JOIN fix
- **New test file** `src/bun/test/code-review-executor.test.ts` — executor-level integration test asserting `onTaskUpdated` carries correct model
- **New test file** `src/bun/test/executor-test-helpers.ts` — extracted shared test stubs (`TestEngine`, `CapturingParamsBuilder`, `StubWorkdirResolver`, `StubStreamProcessor`) currently duplicated between executor test files
- **Extended** `src/bun/test/handlers.test.ts` — 5 new tests asserting session WS push and HTTP response carry correct model (not null) for `setModel`, `create`, `rename`, `archive`, `cancel`
- **Extended** `src/bun/test/orchestrator.test.ts` — 2 new tests asserting `taskUpdates.last.model` is preserved after cancel and shell approval
- **Extended** `src/bun/test/transition-executor.test.ts` — 1 new test asserting `result.task.model` is preserved
- **Extended** `src/mainview/stores/task.test.ts` — 2 new tests asserting `onTaskUpdated` correctly round-trips the model field
- **Extended** `src/mainview/stores/chat.test.ts` — 2 new tests asserting `onChatSessionUpdated` correctly round-trips the model field
- **Extended** `e2e/ui/model-persistence.spec.ts` — 4 new Playwright tests covering the WS-push-with-null scenario that was the actual user-visible bug

## Capabilities

### New Capabilities
- `model-select-reset-test-coverage`: Full regression suite for model preservation across all WebSocket push paths — backend unit, integration, frontend store, and Playwright E2E layers

### Modified Capabilities

## Impact

- **New files**: `task-queries.test.ts`, `task-repository.test.ts`, `code-review-executor.test.ts`, `executor-test-helpers.ts`
- **Extended test files**: `handlers.test.ts`, `orchestrator.test.ts`, `transition-executor.test.ts`, `task.test.ts`, `chat.test.ts`, `model-persistence.spec.ts`
- **Refactoring**: `executor-test-helpers.ts` extraction eliminates stub duplication between `human-turn-executor.test.ts` and `code-review-executor.test.ts` — this is a genuine DRY improvement, not a test-only artifact
- **No production code changes** — this change is purely additive to the test suite
- **Depends on**: `fix-model-select-reset` (the production fix must be applied first for tests to pass)
