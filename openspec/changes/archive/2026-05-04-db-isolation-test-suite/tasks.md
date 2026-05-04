## 1. New Test Files

- [x] 1.1 Create `src/bun/test/workspace-repository.test.ts` — unit tests for `WorkspaceRepository` using `initDb()` + direct SQL inserts; cover scenarios WR-1 through WR-5 (getBoardWorkspaceKey valid/missing, getTaskWorkspaceKey valid/missing, IWorkspaceRepository type contract)
- [x] 1.2 Create `src/bun/test/board-tool-executor.test.ts` — integration tests for `BoardToolExecutor` using real `WorkspaceRepository(db)` with `initDb()` + `setupTestConfig()`; cover scenarios BE-1 through BE-6 (constructor contract, getTask, getTask error, createTask, moveTask, messageTask)

## 2. Fix Production-DB Bug

- [x] 2.1 Fix `src/bun/test/common-tools-registration.test.ts` — add `beforeEach` with `initDb()` + `setupTestConfig()`, move `const baseContext` construction inside `beforeEach` using `new TodoRepository(db)` and `new BoardToolExecutor(db, new WorkspaceRepository(db))`

## 3. Adapt Existing Tests (DI Signature Changes)

- [x] 3.1 Update `src/bun/test/tasks-tools.test.ts` — add `boardTools: new BoardToolExecutor(db, new WorkspaceRepository(db))` to the `commonCtx()` helper; add `wsRepo` variable in `beforeEach`
- [x] 3.2 Update `src/bun/test/boards.test.ts` — replace all `boardHandlers()` calls with `boardHandlers(db, wsRepo)`; delete `DR-1` test (it becomes a compile error by design); add `let wsRepo: WorkspaceRepository` in `beforeEach`
- [x] 3.3 Update `src/bun/test/handlers.test.ts` — update handler factory calls with `(db, wsRepo)` wherever handlers changed signature
- [x] 3.4 Update `src/bun/test/orchestrator.test.ts` — add `wsRepo: IWorkspaceRepository` to `makeOrchestrator()` and pass it to `new Orchestrator(db, wsRepo, registry, ...)`
- [x] 3.5 Update `src/bun/test/transition-executor.test.ts` — change `class StubWorkdirResolver extends WorkingDirectoryResolver` to `class StubWorkdirResolver implements IWorkingDirectoryResolver`; remove `super()` call; update all `new TransitionExecutor(...)` calls with `wsRepo`
- [x] 3.6 Update `src/bun/test/retry-executor.test.ts` — update `new RetryExecutor(...)` constructor calls to include `wsRepo`
- [x] 3.7 Update `src/bun/test/human-turn-executor.test.ts` — update `new HumanTurnExecutor(...)` constructor calls to include `wsRepo`
- [x] 3.8 Update `src/bun/test/working-directory-resolver.test.ts` — update all `new WorkingDirectoryResolver(...)` calls to include `(db, wsRepo)` arguments

## 4. Verification

- [x] 4.1 Run `bun test src/bun --timeout 20000` and confirm all tests pass; the two pre-existing failures (`claude-adapter.test.ts` shell binary filter, `copilot-rpc-scenarios.test.ts` cancellation race) are acceptable
