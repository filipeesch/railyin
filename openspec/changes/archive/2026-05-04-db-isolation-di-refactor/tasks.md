## 1. New DB-Injected Classes

- [x] 1.1 Create `IWorkspaceRepository` interface and `WorkspaceRepository` class in `src/bun/db/workspace-repository.ts` with constructor `(db: Database)`, implementing `getBoardWorkspaceKey(boardId)` and `getTaskWorkspaceKey(taskId)` using the same queries as the removed free functions
- [x] 1.2 Create `IBoardToolExecutor` interface and `BoardToolExecutor` class in `src/bun/workflow/tools/board-tool-executor.ts` with constructor `(db: Database, wsRepo: IWorkspaceRepository)`, migrating all logic from the free functions in `board-tools.ts`
- [x] 1.3 Extract `IWorkingDirectoryResolver` interface (`{ resolve(task: TaskRow): string }`) in `src/bun/engine/execution/working-directory-resolver.ts`; update `WorkingDirectoryResolver` to implement it and accept `(db: Database, wsRepo: IWorkspaceRepository)` constructor; update all consumer type annotations (`Orchestrator`, `TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`) from the concrete class to the interface

## 2. CommonToolContext and common-tools.ts

- [x] 2.1 Add `boardTools: IBoardToolExecutor` field to `CommonToolContext` in `src/bun/engine/types.ts`
- [x] 2.2 Update `executeCommonToolText` in `src/bun/engine/common-tools.ts` to dispatch board/task tools via `ctx.boardTools.*` instead of the free function imports from `board-tools.ts`; remove the free function imports

## 3. Handler Functions

- [x] 3.1 Update `boardHandlers(db, wsRepo)` in `src/bun/handlers/boards.ts` to accept and use injected `db` and `wsRepo` instead of calling `getDb()` and free workspace functions internally
- [x] 3.2 Update `taskHandlers(db, wsRepo)` in `src/bun/handlers/tasks.ts` similarly
- [x] 3.3 Update `projectHandlers(db, wsRepo)` in `src/bun/handlers/projects.ts` similarly (covers the `project-store.ts` cascade `getDb()` call)
- [x] 3.4 Update remaining handlers (`conversations.ts`, `lsp.ts`, `models.ts`, `workspace.ts`, `chat-sessions.ts`) to accept `wsRepo` and use it for workspace key lookups

## 4. Engine Interior

- [x] 4.1 Update `WorkingDirectoryResolver` constructor (already done in task 1.3 — wire `db` and `wsRepo` into existing call sites in `src/bun/engine/execution/working-directory-resolver.ts` and propagate the interface type through `Orchestrator` and all executor constructors)
- [x] 4.2 Update `TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, `CodeReviewExecutor` constructors in `src/bun/engine/execution/*.ts` to accept `wsRepo: IWorkspaceRepository` and use it for workspace key lookups
- [x] 4.3 Update `ClaudeEngine` constructor in `src/bun/engine/claude/engine.ts` to accept `(db: Database, wsRepo: IWorkspaceRepository, ...)` and build `CommonToolContext` with injected `boardTools`
- [x] 4.4 Update `CopilotEngine` constructor in `src/bun/engine/copilot/engine.ts` similarly

## 5. Orchestrator and App Root

- [x] 5.1 Update `Orchestrator` constructor in `src/bun/engine/orchestrator.ts` to accept `wsRepo: IWorkspaceRepository` and distribute it to all executors and engine-factory calls
- [x] 5.2 Update `src/bun/index.ts`: call `getDb()` once, construct `new WorkspaceRepository(db)`, and pass `db` + `wsRepo` to all handlers and the `Orchestrator`

## 6. Remove Dead Free Functions

- [x] 6.1 Remove `getBoardWorkspaceKey` and `getTaskWorkspaceKey` free functions from `src/bun/workspace-context.ts`; update any remaining import sites to use `IWorkspaceRepository`
- [x] 6.2 Remove exported free functions `execGetTask`, `execGetBoardSummary`, `execListTasks`, `execCreateTask`, `execEditTask`, `execDeleteTask`, `execMoveTask`, `execMessageTask` from `src/bun/workflow/tools/board-tools.ts`

## 7. Dev/Prod Scripts and README

- [x] 7.1 Update `scripts/dev.ts`: flip default to `const memoryDb = !argv.includes("--real-db")`; keep `--memory-db` as a no-op alias
- [x] 7.2 Add `"prod": "bun scripts/dev.ts -- --real-db"` to `package.json` scripts
- [x] 7.3 Rewrite the Development and Testing sections of `README.md`: document `bun run dev` (memory DB) vs `bun run prod` (real DB); replace the Electrobun-era UI test scripts with current Playwright commands; remove the debug HTTP bridge section entirely

## 8. Test Fixes

- [x] 8.1 Fix `src/bun/test/common-tools-registration.test.ts`: add `beforeEach` with `initDb()` + `setupTestConfig()`, move `baseContext` construction inside `beforeEach` using `new TodoRepository(db)` and `new BoardToolExecutor(db, new WorkspaceRepository(db))`
- [x] 8.2 Run `bun test src/bun --timeout 20000` and confirm all tests pass (pre-existing failures in `claude-adapter.test.ts` and `copilot-rpc-scenarios.test.ts` are known and acceptable)
