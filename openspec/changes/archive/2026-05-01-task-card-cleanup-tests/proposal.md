## Why

The `task-card-cleanup` change removes `changedFileCounts`, `refreshChangedFiles`, and the file-changes badge from the codebase, and adds project name display to `TaskCard`. Without a dedicated test change:

- Unit test `T8` in `task.test.ts` will fail to compile (it directly calls `store.refreshChangedFiles` and asserts `store.changedFileCounts`, both of which are removed).
- The surviving `file_diff` unread-detection path in `taskStore` has no explicit test, making it easy to accidentally delete in a future cleanup pass.
- `board-project-badge.spec.ts` contains a single `test.fail()` stub (PB-1, a known gap) that will never pass without real implementation and real assertions.

## What Changes

- **Remove `T8`** from `src/mainview/stores/task.test.ts` — it tests deleted exports (`changedFileCounts`, `refreshChangedFiles`).
- **Add unit tests** for the surviving `file_diff` unread-detection logic in `taskStore` (via `onTaskStreamEvent` and `onTaskNewMessage`).
- **Rewrite `board-project-badge.spec.ts`** — replace the single `test.fail()` stub with a full `PB-*` suite covering project name display, multi-project boards, fallback to project key, absence of file-changes badge, and absence of retry indicator.

## Capabilities

### New Capabilities

- `task-card-display-tests`: Test coverage contract for the `task-card-display` capability — what scenarios are verified by automated tests and at which layer.

### Modified Capabilities

*(none — no spec-level behavior changes; test files are not specs)*

## Impact

- **`src/mainview/stores/task.test.ts`** — remove T8, add T-A (`onTaskStreamEvent` file_diff marks unread) and T-B (`onTaskNewMessage` file_diff marks unread).
- **`e2e/ui/board-project-badge.spec.ts`** — full rewrite: 6 Playwright tests (PB-1 through PB-6).
- **`e2e/ui/fixtures/index.ts`** — baseline `projects.list` mock stays `[]`; individual tests add `makeProject()` where needed (already the pattern).
- No production code changes. No new dependencies.
