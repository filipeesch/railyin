## Context

The `fix-model-select-reset` production change fixes 9 bare-query sites across the backend and removes a frontend timing workaround (`isUserChangingModel` guard). Without tests, any of these fixes could silently regress: a future bare `SELECT * FROM tasks` added to a push path would reintroduce the model-reset bug with no safety net.

The existing test infrastructure already supports all required test patterns via dependency injection:
- `Orchestrator` takes `onTaskUpdated` as constructor param → captured via `taskUpdates: Task[]` array already in `orchestrator.test.ts`
- `chatSessionHandlers(db, onSessionUpdated, ...)` → 2nd arg passed as `() => {}` noop in current tests; replacing with a capturing callback is the only change required
- All executor classes inject `onTaskUpdated` via constructor → instantiable in tests with no mocking infrastructure changes
- `seedProjectAndTask(db, gitDir)` already seeds `conversations.model = 'fake/fake'` — the seeded value to assert against
- Playwright: `ws.push({ type: "chatSession.updated", payload })` already established in `model-persistence.spec.ts`

**Executor stub duplication**: `TestEngine`, `CapturingParamsBuilder`, `StubWorkdirResolver`, `StubStreamProcessor` are currently defined only in `human-turn-executor.test.ts`. Creating `code-review-executor.test.ts` would duplicate them. Extracting to `executor-test-helpers.ts` is a genuine DRY improvement (not test-only) that also removes a maintenance hazard.

## Goals / Non-Goals

**Goals:**
- Regression-protect all 9 bug sites fixed in `fix-model-select-reset` with targeted assertions
- Unit-test the new `task-queries.ts` module in isolation
- Regression-test `TaskRepository.findById` model propagation
- Playwright-cover the direct user-visible scenario (WS push with correct model does not reset dropdown)
- Extract executor test stubs to eliminate duplication across executor test files

**Non-Goals:**
- Full integration test coverage for `code-review-executor.ts` beyond model propagation
- Performance tests
- Any production code change — this change is purely additive to the test suite
- Snapshot testing or visual regression

## Decisions

### Decision: Extract executor stubs to `executor-test-helpers.ts`

**Choice**: Create `src/bun/test/executor-test-helpers.ts` and import stubs from both `human-turn-executor.test.ts` and `code-review-executor.test.ts`.

**Rationale**: The 4 stubs are already shared concerns — `human-turn-executor.test.ts` should not be the canonical owner. A future `retry-executor.test.ts` or `board-tool-executor.test.ts` would face the same copy-paste pressure. The extraction is a pure refactor: no behavioral change, no new abstraction, just colocation.

**Alternatives considered**:
- *Inline in each file*: Duplicates ~70 lines; diverges silently when one file is updated
- *Put stubs in helpers.ts*: `helpers.ts` is for DB/config setup; mixing engine-level stubs would widen its scope without gain

### Decision: `handlers.test.ts` uses capturing callback, not spied noop

**Choice**: Replace `() => {}` with `(s) => sessionUpdates.push(s)` in affected tests.

**Rationale**: Constructor/parameter DI is the existing pattern in this codebase. A spy (`vi.fn()`) would also work but adds a vitest import just to verify call count — the array pattern is simpler and consistent with how `orchestrator.test.ts` captures `taskUpdates`.

### Decision: Playwright tests assert frontend model value, not just WS push delivery

**Choice**: Playwright tests navigate to a chat view, set a model, trigger a WS push, then assert the dropdown still shows the originally selected model.

**Rationale**: This is the direct regression test for the user-visible bug. Backend integration tests verify the data is correct at the source; Playwright tests verify the full round-trip: correct data arrives at the frontend and the UI renders it correctly (and does not fall back to `availableModels[0]`). Both layers are needed — one does not substitute for the other.

## Risks / Trade-offs

- **[Risk] `executor-test-helpers.ts` extraction breaks `human-turn-executor.test.ts`** → Mitigation: extraction is a pure import refactor; run backend tests after to confirm
- **[Risk] Playwright model-persistence tests are flaky if WS push timing is not controlled** → Mitigation: use `ws.push()` synchronously after model selection; existing `model-persistence.spec.ts` already does this safely for SM-1 through SM-3
- **[Risk] `OC-MODEL-1` (orchestrator cancel) requires a running execution to cancel** → Mitigation: pattern already exists in `orchestrator.test.ts` "marks non-native executions cancelled immediately" — manual INSERT + direct cancel call; follow same approach
