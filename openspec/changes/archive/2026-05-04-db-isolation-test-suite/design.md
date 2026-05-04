## Context

The `db-isolation-di-refactor` change rewires all DB-touching constructors to accept explicit `Database` + `IWorkspaceRepository` arguments. This cascades into every test file that constructs the affected classes. The test suite change is purely about keeping the tests aligned with the new signatures — no new production behavior is introduced.

Two decisions shaped the test strategy:

1. **`StubWorkdirResolver` coupling** — `transition-executor.test.ts` subclasses `WorkingDirectoryResolver`. Once that class gains required constructor args, the `super()` call breaks. Since `StubWorkdirResolver` already fully overrides `resolve()` without calling `super.resolve()`, the inheritance is purely coupling. Extracting `IWorkingDirectoryResolver` (added to the main refactor change as D-7) lets the stub implement the interface directly — no `super()` needed.

2. **`board-tool-executor.test.ts` depth** — integration style with `real WorkspaceRepository(db)` (decision confirmed with team). This gives strong evidence that the wiring from `BoardToolExecutor` → `WorkspaceRepository` → DB is correct without mocks obscuring failures. The existing `tasks-tools.test.ts` already covers all 8 tool methods at the `executeCommonTool()` layer; the new file focuses on constructor contract and workspace routing.

## Goals / Non-Goals

**Goals:**
- Every test file compiles and passes after `db-isolation-di-refactor` is applied
- `WorkspaceRepository` and `BoardToolExecutor` each have dedicated test files from day one
- `common-tools-registration.test.ts` is structurally fixed (no module-level DB access)
- `StubWorkdirResolver` no longer inherits from the concrete class
- The adapted test files demonstrate the DI setup pattern for future contributors

**Non-Goals:**
- Exhaustive re-testing of scenarios already covered in `tasks-tools.test.ts` — the new `board-tool-executor.test.ts` focuses on the integration seam, not duplicating the 50+ existing tool scenarios
- Playwright / e2e API test changes — this is a pure backend DI refactor with no UI surface
- Fixing tests beyond the ones that break from the signature changes
- Adding mocks/stubs for `IWorkspaceRepository` in tests — real `WorkspaceRepository(db)` preferred wherever integration coverage is appropriate

## Decisions

### D-1: `board-tool-executor.test.ts` uses real `WorkspaceRepository(db)`, not a stub

Real `WorkspaceRepository(db)` with in-memory DB. This tests the actual class boundary rather than mocking it away, and keeps setup simple (no stub class to maintain). The in-memory DB is already used throughout the suite so this follows established patterns.

*Alternative considered*: Stub `IWorkspaceRepository` that returns hardcoded keys. Rejected — would require a stub class to maintain and would miss the integration between `BoardToolExecutor` and workspace routing.

### D-2: `StubWorkdirResolver` switches from `extends` to `implements`

`StubWorkdirResolver` in `transition-executor.test.ts` currently subclasses `WorkingDirectoryResolver` but never calls `super.resolve()`. Once `WorkingDirectoryResolver` gains constructor params, `super()` would require forwarding `db` + `wsRepo` that the stub doesn't use. Implementing `IWorkingDirectoryResolver` directly is cleaner and future-proof.

*Alternative considered*: Pass `db, null as never` to `super()`. Rejected — type-unsafe hack that makes the code harder to read.

### D-3: Adapted tests use `new WorkspaceRepository(db)` directly — no shared fixture

Each adapted test file constructs its own `WorkspaceRepository(db)` and `BoardToolExecutor(db, wsRepo)` in `beforeEach`. A shared factory could be added to `helpers.ts`, but the added abstraction doesn't justify the indirection given there are only ~8 affected files.

*Alternative considered*: Add `makeWsRepo(db)` / `makeBoardToolExecutor(db)` to `helpers.ts`. Revisit if more than 3 files end up with identical setup.

## Risks / Trade-offs

- **Sequencing dependency** — this change cannot be implemented before `db-isolation-di-refactor` is complete. The new class signatures must exist before tests can reference them. → Tracked as explicit dependency in `tasks.md`.
- **DR-1 regression test disappears** — `boards.test.ts` has `DR-1: boardHandlers() with no args…` which was intentionally testing the no-arg signature. After refactor, that call is a compile error (correct). The test is deleted, not replaced. → The TypeScript compiler enforces the invariant instead of a runtime test.
- **`bun:test` vs `vitest` inconsistency** — `boards.test.ts` imports from `bun:test`; all other backend tests use `vitest`. Adaptation changes only the DI wiring, not the test runner import. No change needed here; noted for a future homogenization task.
