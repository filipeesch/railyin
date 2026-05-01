## 1. Unit tests — task.test.ts

- [x] 1.1 Remove test `T8: deleteTask removes changedFileCounts entry` (references deleted exports `changedFileCounts` and `refreshChangedFiles`)
- [x] 1.2 Add test `T-A: onTaskStreamEvent file_diff marks inactive task unread` — seed two tasks, set active conversation to task 1, call `onTaskStreamEvent({ type: "file_diff", taskId: 2, conversationId: 2 })`, assert `hasUnread(2) === true` and `hasUnread(1) === false`
- [x] 1.3 Add test `T-B: onTaskNewMessage file_diff marks inactive task unread` — same setup, call `onTaskNewMessage({ type: "file_diff", taskId: 2, conversationId: 2, ... })`, assert `hasUnread(2) === true` and `hasUnread(1) === false`
- [x] 1.4 Run `bun test src/mainview/stores/task.test.ts` and confirm all tests pass

## 2. Playwright — board-project-badge.spec.ts (full rewrite)

- [x] 2.1 Replace `test.fail()` stub with `PB-1`: set `projects.list: [makeProject()]` and default task (`projectKey: "test-project"`); assert card contains "Test Project" in `.task-card__project` or `[data-testid="project-name"]`
- [x] 2.2 Add `PB-2`: baseline `projects.list: []` (default fixture); assert card contains "test-project" (the raw key) in the project name element
- [x] 2.3 Add `PB-3`: `projects.list: [makeProject({key:"alpha",name:"Alpha"}), makeProject({key:"beta",name:"Beta"})]` and `tasks.list: [makeTask({id:1,projectKey:"alpha"}), makeTask({id:2,projectKey:"beta"})]`; assert card for task 1 shows "Alpha" and card for task 2 shows "Beta"
- [x] 2.4 Add `PB-4`: `tasks.getChangedFiles` returns `["src/foo.ts", "src/bar.ts"]`; assert `page.locator(".task-card__changed-badge").toHaveCount(0)`
- [x] 2.5 Add `PB-5`: task with `retryCount: 3`; assert `page.locator(".task-card__retry-count").toHaveCount(0)`
- [x] 2.6 Add `PB-6`: resolved project; assert `.task-card__footer` contains both a `.p-tag` and the project name element as visible descendants

## 3. Verification

- [x] 3.1 Run `bun test src/mainview/stores/task.test.ts --timeout 20000` — all tests pass, T8 is gone
- [x] 3.2 Run `bun run build && npx playwright test e2e/ui/board-project-badge.spec.ts` — all 6 PB tests pass
