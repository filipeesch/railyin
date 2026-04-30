## 1. Backend unit tests — pure / in-memory DB

- [x] 1.1 Create `src/bun/test/transition-validator.test.ts` — 7 scenarios (TV-1..TV-7) using `initDb()` + `setupTestConfig({ extraWorkflows: [...] })` to inject workflow YAML with `allowed_transitions` and `limit` fields. Import `validateTransition` directly from `../workflow/transition-validator.ts`. Use `seedProjectAndTask()` to get a real task row. One describe block per spec ID.

- [x] 1.2 Create `src/bun/test/todo-handlers.test.ts` — 10 scenarios (TH-1..TH-10) using `initDb()` + `seedProjectAndTask()`. Construct `todoHandlers(db)` with the in-memory DB and call handler functions directly. Verify that `db` injection is actually used by confirming data inserted via the handler is visible via `db.query(...)` — proves no singleton fallback.

- [x] 1.3 Create `src/bun/test/model-handlers.test.ts` — 3 scenarios (MH-1..MH-3) using `initDb()`. Mock orchestrator as a plain object: `{ listModels: async () => mockList }`. Construct `modelHandlers(db, mockOrchestrator)`. Verify `models.setEnabled` writes to the `enabled_models` table in the in-memory DB.

- [x] 1.4 Create `src/bun/test/engine-handlers.test.ts` — 2 scenarios (EH-1..EH-2) using a plain mock orchestrator `{ listCommands: async () => mockCmds }`. Construct `engineHandlers(mockOrchestrator)` and `engineHandlers(null)`. Assert command list and empty array results.

## 2. Backend unit tests — real git tmpdir

- [x] 2.1 Create `src/bun/test/diff-utils.test.ts` — 12 scenarios (DU-1..DU-12). Pure scenarios (DU-1..DU-9) use inline diff strings — no git needed. Git tmpdir scenarios (DU-10..DU-12) use `mkdtempSync` + `execSync("git init")` pattern from `worktree.test.ts`. Import the four functions from `../git/diff-utils.ts`. Clean up tmpdir in `afterEach`.

- [x] 2.2 Create `src/bun/test/task-git-handlers.test.ts` — 3 scenarios (TG-1..TG-3). Create a real git repo via `mkdtempSync` + `execSync("git init/commit")`. Use `setupTestConfig({ worktree_base_path: worktreesBase })` and `initDb()`. Call `registerProjectGitContext` to seed git context, then invoke `taskGitHandlers(db, onTaskUpdated)` handlers. Assert filesystem state (TG-2) and return values (TG-1, TG-3). Clean up both temp dirs in `afterEach`.

- [x] 2.3 Create `src/bun/test/code-review-handlers.test.ts` — 7 scenarios (CR-1..CR-7). Set up a real git tmpdir with at least one committed file. Modify the file to create uncommitted diff. Use `initDb()` + `seedProjectAndTask()` + inject `worktreePath` into the task's git context row. Call `codeReviewHandlers(db)` handlers. For CR-5 and CR-6 (line comments), no git needed — use a fake file path since comments are DB-only. Clean up tmpdir in `afterEach`.

## 3. Playwright spec — allowed transitions UI

- [x] 3.1 Create `e2e/ui/board-allowed-transitions.spec.ts` — 4 scenarios (AT-1..AT-4). Use `setupBoardWithTemplate` with a custom template where `backlog` has `allowedTransitions: ["plan"]`. Add one task in backlog. For AT-1/AT-4: use `startDragOnCard` helper (from `board-dnd.spec.ts`), then check `.is-drag-forbidden` class presence on each column locator. For AT-2: after drag-start, move mouse over a forbidden column, then `page.evaluate` to check `getComputedStyle(el).cursor`. For AT-3: `api.capture("tasks.transition", ...)` before drag, release pointer on forbidden column, wait 200ms, assert zero calls.

## 4. Verify

- [x] 4.1 Run `bun test src/bun/test --timeout 20000` — all 7 new files pass with 0 failures
- [x] 4.2 Run `bun run build && npx playwright test e2e/ui/board-allowed-transitions.spec.ts` — all 4 AT scenarios pass
