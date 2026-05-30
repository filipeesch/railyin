## 1. Backend unit — stream-processor.test.ts

- [x] 1.1 Add helper in test to insert a `task_git_context` row (inline `db.run`, no new helper function)
- [x] 1.2 Add `SP-GC-1`: capture `Task` from `onTaskUpdated` spy; seed git context row; run `NoopEngine`; assert `capturedTask.worktreePath === "/wt/1"`
- [x] 1.3 Add `SP-GC-2`: no git context row; run `NoopEngine`; assert `capturedTask.worktreePath === null`

## 2. Backend unit — transition-executor.test.ts

- [x] 2.1 Add `TE-GC-1`: insert `task_git_context` row for the task; call `transition()` to a no-prompt column; assert returned `task.worktreePath === "/wt/1"`

## 3. Backend unit — retry-executor.test.ts

- [x] 3.1 Add `RE-GC-1`: insert `task_git_context` row for the task; call `retry()`; assert returned `task.worktreePath === "/wt/1"`

## 4. Backend unit — human-turn-executor.test.ts (new file)

- [x] 4.1 Scaffold `human-turn-executor.test.ts` following the `retry-executor.test.ts` pattern (`StubStreamProcessor`, `StubWorkdirResolver`, `TestEngine`, `initDb`, `setupTestConfig`, real git dir setup)
- [x] 4.2 Add `HT-GC-1`: task in `waiting_user` state; seed git context row; inject `onTaskUpdated` spy; call `handleMessage()`; assert spy received `Task` with `worktreePath === "/wt/1"`
- [x] 4.3 Add `HT-GC-2`: simulate session-lost fallback path; seed git context row; assert spy received `Task` with `worktreePath === "/wt/1"`
- [x] 4.4 Add `HT-GC-3`: new execution start path; seed git context row; assert spy received `Task` with `worktreePath === "/wt/1"`

## 5. Frontend Bun — task.test.ts

- [x] 5.1 Add `T-WT-1`: call `store.onTaskUpdated({ ...task, worktreePath: "/wt/1", executionState: "completed" })`; assert `store.taskIndex[task.id].worktreePath === "/wt/1"`

## 6. Playwright — board-ws-updates.spec.ts

- [x] 6.1 Add `WS-WT-1` (regression sentinel): load task with `worktreePath="/wt/1"` and `worktreeStatus="ready"`; open task drawer; assert Terminal button visible; push `task.updated` with `worktreePath: null`; assert Terminal button no longer visible
- [x] 6.2 Add `WS-WT-2` (green path): same setup; push `task.updated` with `worktreePath: "/wt/1"` preserved; assert Terminal button (`pi-desktop`) and Code Server button (`pi-code`) remain visible

## 7. Verify

- [x] 7.1 Run `bun test src/bun/test --timeout 20000` — all new tests pass
- [x] 7.2 Run `bun test src/mainview/stores/task.test.ts` — T-WT-1 passes
- [x] 7.3 Run `bun run build && npx playwright test e2e/ui/board-ws-updates.spec.ts` — WS-WT-1 and WS-WT-2 pass
