## Why

The `db-isolation-di-refactor` change introduces two new injectable classes (`WorkspaceRepository`, `BoardToolExecutor`) and threads `Database` through the entire handler/engine tree. Every test file that constructs those classes, executors, engines, or handlers must be updated to pass the new required constructor arguments — and the DI refactor is the opportunity to also write the new coverage those classes need from day one. Additionally, `StubWorkdirResolver extends WorkingDirectoryResolver` becomes a brittle coupling once `WorkingDirectoryResolver` gains constructor params; extracting `IWorkingDirectoryResolver` makes the test stub clean.

## What Changes

- **New `workspace-repository.test.ts`** — unit tests for `WorkspaceRepository` covering all DB edge cases (missing board, missing task, fallback to default).
- **New `board-tool-executor.test.ts`** — integration tests for `BoardToolExecutor` with real `WorkspaceRepository(db)`, verifying the class satisfies `IBoardToolExecutor` and that workspace routing flows through correctly.
- **`common-tools-registration.test.ts` fixed** — module-level `new TodoRepository()` (the confirmed production-DB-touching call) moved into `beforeEach` with `initDb()` and injected `db`.
- **`tasks-tools.test.ts` adapted** — `commonCtx()` helper gains `boardTools: new BoardToolExecutor(db, wsRepo)`.
- **`boards.test.ts` adapted** — all `boardHandlers()` calls become `boardHandlers(db, wsRepo)`; the `DR-1` "no-args" regression test becomes a compile error (the correct invariant after the refactor).
- **`handlers.test.ts` adapted** — handler factory calls updated with `(db, wsRepo)`.
- **`orchestrator.test.ts` adapted** — `Orchestrator` constructor gains `wsRepo` param; `makeOrchestrator()` updated.
- **`transition-executor.test.ts` adapted** — `StubWorkdirResolver` switches from `extends WorkingDirectoryResolver` to `implements IWorkingDirectoryResolver`; `super()` removed.
- **`retry-executor.test.ts` adapted** — executor constructor gains `wsRepo`.
- **`human-turn-executor.test.ts` adapted** — executor constructor gains `wsRepo`.
- **`working-directory-resolver.test.ts` adapted** — `new WorkingDirectoryResolver(db, wsRepo)` in all test cases.

## Capabilities

### New Capabilities

- `workspace-repository-tests`: Unit test coverage for `IWorkspaceRepository` / `WorkspaceRepository` (all DB scenarios, fallback behavior, interface contract).
- `board-tool-executor-tests`: Integration test coverage for `IBoardToolExecutor` / `BoardToolExecutor` (constructor contract, workspace routing via injected `WorkspaceRepository`, all 8 tool methods).

### Modified Capabilities

- `test-infrastructure`: No-module-level-`getDb()` rule now enforced by new test coverage; `common-tools-registration.test.ts` structurally fixed; all adapted test files document the required DI setup pattern for future contributors.

## Impact

- **New files**: `src/bun/test/workspace-repository.test.ts`, `src/bun/test/board-tool-executor.test.ts`
- **Modified files**: `src/bun/test/common-tools-registration.test.ts`, `src/bun/test/tasks-tools.test.ts`, `src/bun/test/boards.test.ts`, `src/bun/test/handlers.test.ts`, `src/bun/test/orchestrator.test.ts`, `src/bun/test/transition-executor.test.ts`, `src/bun/test/retry-executor.test.ts`, `src/bun/test/human-turn-executor.test.ts`, `src/bun/test/working-directory-resolver.test.ts`
- **Dependency**: Requires `db-isolation-di-refactor` to be implemented first — all adapted tests depend on the new class signatures.
- No API contract changes. No DB schema changes. No Playwright test changes (no UI surface).
