## Why

The `fix-board-and-drawer-bugs` change fixes 7 production bugs but ships zero new tests. Without a regression suite, the same stale-snapshot, missing-JOIN, and scroll-coordination bugs can silently regress. This change adds the unit and Playwright tests that lock in the correct behaviour for each fix.

## What Changes

- **New unit test file** `src/bun/test/task-repository.test.ts` covering `findById` with git context, without git context, and for a missing task ID.
- **Extended `transition-executor.test.ts`** with TE-7 and TE-8: verifying that a with-prompt transition returns `executionState: 'running'` and a non-null `currentExecutionId` in the result.
- **Extended `stream-processor.test.ts`** with SP-7 (catch path aborts signal + emits `done`), SP-8 (fatal-error path aborts signal + emits `done`), and SP-9 (`onTaskUpdated` receives task with non-null `worktreePath` from LEFT-JOIN read).
- **Extended `board-dnd.spec.ts`** with DND-10: card badge shows `running` state after a drop onto a prompted column.
- **Extended `task-toolbar.spec.ts`** with TT-12 (`allowedTransitions` filters the column select), TT-13 (no `allowedTransitions` → all columns shown), TT-14 (terminal button persists after `task.updated` push that preserves `worktreePath`).
- **Extended `stream-reactivity.spec.ts`** with E-X (send button re-enables after false failure + `done` event) and E-Y (chat scroll position is stable mid-stream — no stutter).
- **Extended `conversation-body.spec.ts`** with CB-X: reasoning bubble `.rb__body` is scrolled to bottom while streaming.
- **Extended `conversation-pagination.spec.ts`** with PAG-9: `load-older` fires when the sentinel is already visible in the viewport at the moment `autoScroll` transitions to `false`.

## Capabilities

### New Capabilities

- `task-repository-tests`: Unit tests for `TaskRepository.findById` covering the LEFT JOIN path (with git context), the null-context path (no git context row), and the not-found path.
- `transition-executor-regression-tests`: Extended unit tests for `TransitionExecutor` asserting that the task returned from a with-prompt transition always carries the post-write `executionState` and `currentExecutionId`.

### Modified Capabilities

- `stream-processor-tests-updated`: Add SP-7, SP-8 (error + fatal-error paths fire `.abort()` and emit `done`), and SP-9 (post-execution `onTaskUpdated` callback receives task with correct `worktreePath`).
- `board-playwright-coverage`: Add DND-10 — after a drag-to-prompted-column transition, the card badge reflects the `running` execution state returned in the transition response.
- `chat-drawer-test-coverage`: Add TT-12 (select filtered when `allowedTransitions` set), TT-13 (all columns shown when unrestricted), TT-14 (terminal button survives a `task.updated` push).
- `ui-stream-reactivity-tests`: Add E-X (false failure path unlocks send button once `done` is received) and E-Y (scroll position remains at bottom across multiple mid-stream checkpoints).
- `conversation-pagination`: Add PAG-9 — `load-older` is emitted when `autoScroll` flips false with the sentinel already in the viewport (verified via `evaluate()` to set `scrollTop`).
- `conversation`: Add CB-X — `ReasoningBubble` `.rb__body` `scrollTop` is at `scrollHeight` during active streaming.

## Impact

- **Test files added**: `src/bun/test/task-repository.test.ts`
- **Test files modified**: `src/bun/test/transition-executor.test.ts`, `src/bun/test/stream-processor.test.ts`, `e2e/ui/board-dnd.spec.ts`, `e2e/ui/task-toolbar.spec.ts`, `e2e/ui/stream-reactivity.spec.ts`, `e2e/ui/conversation-body.spec.ts`, `e2e/ui/conversation-pagination.spec.ts`
- **Production code**: none — test-only change
- **No breaking API changes**
