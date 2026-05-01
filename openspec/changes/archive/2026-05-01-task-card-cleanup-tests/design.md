## Context

`task-card-cleanup` deletes `changedFileCounts`, `refreshChangedFiles`, and the `openReview` event chain. This breaks one existing unit test (`T8`) and leaves the surviving `file_diff` unread-detection logic untested. A `test.fail()` stub in `board-project-badge.spec.ts` marks a known gap for project badge display.

This change writes the missing tests and removes the broken one.

## Goals / Non-Goals

**Goals:**
- Remove `T8` from `task.test.ts` (tests deleted exports — will not compile after cleanup).
- Cover the `file_diff` → unread path in `taskStore` at the unit level.
- Replace the `test.fail()` stub with a real Playwright suite for `task-card-display`.

**Non-Goals:**
- No Vue component unit tests (no Vue Test Utils in this codebase — Playwright is the component layer).
- No truncation assertion — CSS-only behavior, not automated.
- No backend tests — no backend changes.

## Decisions

### D1: Unit test isolation via Pinia dependency injection

**Decision:** Use `createPinia()` + `setActivePinia()` + `vi.mock("../rpc", ...)` to inject a controlled API mock. No alternative code paths (`if (TEST_MODE)`) anywhere in production code.

**Rationale:** All existing unit tests in `task.test.ts` use this exact pattern. Consistent with the codebase, avoids coupling test infrastructure to production code. The new `T-A` and `T-B` tests follow the same setup:

```ts
beforeEach(() => {
  setActivePinia(createPinia());
  apiMock.mockImplementation(async () => []);
});
```

Then seed tasks, call `onTaskStreamEvent` / `onTaskNewMessage` directly, and assert `hasUnread()`.

### D2: Playwright mock injection via ApiMock — not global state

**Decision:** Each Playwright test injects project data via `api.returns("projects.list", [...])` before `page.goto("/")`. The global fixture baseline leaves `projects.list: []` — tests that need projects explicitly add them.

**Rationale:** ApiMock already uses `page.route()` interception — pure dependency injection with no production code touching. Follows the established pattern (see `board-create-task.spec.ts`, `workspace-settings.spec.ts`). Tests are self-contained and can run in any order.

### D3: Absence assertions for removed elements

**Decision:** Assert `toHaveCount(0)` (not `toBeHidden()`) for removed elements like `.task-card__changed-badge` and retry indicators.

**Rationale:** `toBeHidden()` passes if the element exists but is hidden. `toHaveCount(0)` confirms the element is not in the DOM at all — the correct assertion for code removal.

### D4: Multi-project test uses two distinct tasks and two projects

**Decision:** PB-3 seeds two tasks (`projectKey: "alpha"` and `projectKey: "beta"`) alongside two project objects, both in the backlog column.

**Rationale:** This is the only scenario that exercises the `computed` lookup across multiple entries — the single-project tests only verify the happy path of one lookup. Two tasks on the same board in the same column tests that each card independently resolves its own project.

### D5: Truncation scenario not automated

**Decision:** Spec scenario "Long project name is truncated" is intentionally not automated.

**Rationale:** CSS `text-overflow: ellipsis` is applied by the browser layout engine. Asserting it requires either pixel-level screenshot diffing (brittle, CI-environment-dependent) or computed style inspection (fragile across browser/OS). The behavior is verified by visual inspection during implementation review.
