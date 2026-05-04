## Why

Tests in the backend suite have been opening the production SQLite database (`~/.railyn/railyn.db`) because `getDb()` is called at module load time before `initDb()` can set `RAILYN_DB=:memory:`. Beyond the immediate test-safety issue, the root structural cause is that DB-dependent modules (`board-tools.ts`, `workspace-context.ts`, several handlers) call the global `getDb()` singleton directly instead of receiving a `Database` instance via constructor injection — making them impossible to unit-test without relying on a global env-var side effect.

## What Changes

- **New `WorkspaceRepository` class** — replaces the module-level DB-touching functions in `workspace-context.ts` (`getBoardWorkspaceKey`, `getTaskWorkspaceKey`). Implements `IWorkspaceRepository`. Receives `Database` via constructor.
- **New `BoardToolExecutor` class** — replaces the free functions in `workflow/tools/board-tools.ts`. Implements `IBoardToolExecutor`. Receives `Database` and `IWorkspaceRepository` via constructor.
- **`CommonToolContext` gains `boardTools: IBoardToolExecutor`** — board tool dispatch in `common-tools.ts` delegates to the injected executor instead of calling free functions that reach `getDb()`.
- **All handlers accept `(db, wsRepo)` parameters** — `boardHandlers`, `taskHandlers`, `projectHandlers`, and the remaining handler modules stop calling `getDb()` internally; the app root (`index.ts`) calls `getDb()` once and distributes it.
- **`IWorkingDirectoryResolver` interface extracted** — `WorkingDirectoryResolver` gains a corresponding interface, following the `IBroadcastChannel` pattern. All consumers (`Orchestrator`, executors) type their fields as `IWorkingDirectoryResolver` instead of the concrete class, enabling clean test stubs without inheritance hacks.
- **`WorkingDirectoryResolver` receives `db` and `wsRepo` via constructor** — already a class; adds the missing dependencies so it no longer calls `getDb()` or `getTaskWorkspaceKey()` directly.
- **Engine constructors receive `db` and `wsRepo`** — `ClaudeEngine` and `CopilotEngine` gain the db reference needed to build `CommonToolContext` correctly.
- **`bun run dev` defaults to memory DB; `bun run prod` added** — `scripts/dev.ts` flips the safe-by-default flag; a new `prod` script opts into the real DB explicitly.
- **README updated** — removes Electrobun-era ghost scripts, documents the new `dev`/`prod` distinction and all current test commands.
- **`common-tools-registration.test.ts` fixed** — module-level `new TodoRepository()` moved into `beforeEach` with `initDb()` and explicit `db` injection.

## Capabilities

### New Capabilities

- `workspace-repository`: `IWorkspaceRepository` interface and `WorkspaceRepository` class — DB-backed workspace key lookups, constructor-injected, testable in isolation.
- `board-tool-executor`: `IBoardToolExecutor` interface and `BoardToolExecutor` class — all board/task tool implementations as a cohesive injectable class.
- `working-directory-resolver`: `IWorkingDirectoryResolver` interface extracted; `WorkingDirectoryResolver` gains constructor params `(db, wsRepo)` and implements the interface.
- `dev-prod-db-safety`: `bun run dev` uses memory DB by default; `bun run prod` uses the real DB. Documents the distinction clearly in README.

### Modified Capabilities

- `engine-common-tools`: `CommonToolContext` gains `boardTools: IBoardToolExecutor`; the board-tool dispatch in `executeCommonToolText` delegates to the injected executor.
- `test-infrastructure`: `common-tools-registration.test.ts` fixed to use `initDb()` + injected `db`; documents the rule that no test file may call `getDb()` implicitly at module level.

## Impact

- `src/bun/index.ts` — single call to `getDb()`, constructs `WorkspaceRepository` and distributes both down the entire handler and engine tree.
- `src/bun/workspace-context.ts` — DB-touching functions removed; pure helpers (`getDefaultWorkspaceKey`, `getWorkspaceConfig`) remain as free functions.
- `src/bun/workflow/tools/board-tools.ts` — free functions become methods on `BoardToolExecutor`.
- `src/bun/engine/types.ts` — `CommonToolContext` interface updated.
- `src/bun/handlers/*.ts` — all handler factory functions gain `(db, wsRepo)` parameters.
- `src/bun/engine/execution/working-directory-resolver.ts` — gains `IWorkingDirectoryResolver` interface; constructor changes to `(db: Database, wsRepo: IWorkspaceRepository)`.
- `src/bun/engine/claude/engine.ts`, `src/bun/engine/copilot/engine.ts` — gain `db` + `wsRepo` constructor params.
- `scripts/dev.ts` + `package.json` — new default + `prod` script.
- `README.md` — dev/test documentation overhaul.
- No DB schema changes. No API contract changes.
