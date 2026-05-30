## Why

The `fix-worktree-task-update-join` bug fix has no tests asserting that `task.updated` broadcasts preserve `worktreePath` — meaning the bug could silently regress. This change adds targeted unit, integration, and Playwright tests that directly cover each execution path fixed in the parent change.

## What Changes

- Add `SP-GC-1`, `SP-GC-2` tests to `stream-processor.test.ts` — assert the Task payload passed to `onTaskUpdated` includes `worktreePath` after execution end
- Add `TE-GC-1` to `transition-executor.test.ts` — assert no-prompt transition return value includes `worktreePath`
- Add `RE-GC-1` to `retry-executor.test.ts` — assert retry return task includes `worktreePath`
- Create `human-turn-executor.test.ts` with `HT-GC-1`, `HT-GC-2`, `HT-GC-3` — cover the three `onTaskUpdated` call sites in `HumanTurnExecutor`
- Add `T-WT-1` to `task.test.ts` (frontend Bun) — assert store correctly stores non-null `worktreePath` from `onTaskUpdated`
- Add `WS-WT-1`, `WS-WT-2` to `board-ws-updates.spec.ts` (Playwright) — `WS-WT-1` is the regression sentinel (proves the pre-fix bug pattern), `WS-WT-2` proves buttons survive a correct `task.updated` push
- No production code changes; all test seams already support DI-based spying

## Capabilities

### New Capabilities
- `worktree-broadcast-test-coverage`: Test coverage for the invariant that all `task.updated` broadcasts include complete git-context fields across all execution paths

### Modified Capabilities
_(none — no requirement changes, only test additions)_

## Impact

- **New files**: `src/bun/test/human-turn-executor.test.ts`
- **Modified test files**: `src/bun/test/stream-processor.test.ts`, `src/bun/test/transition-executor.test.ts`, `src/bun/test/retry-executor.test.ts`, `src/mainview/stores/task.test.ts`, `e2e/ui/board-ws-updates.spec.ts`
- No production code changes
- No API changes
