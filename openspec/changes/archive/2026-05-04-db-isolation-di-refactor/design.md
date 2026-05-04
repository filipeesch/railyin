## Context

The backend test suite has been silently opening `~/.railyn/railyn.db` (production) in some tests because several modules call the global `getDb()` singleton at construction/load time, before `initDb()` can set `RAILYN_DB=:memory:`. The canonical example is `common-tools-registration.test.ts` — it constructs `new TodoRepository()` at module level, which eagerly calls `getDb()` before any `beforeEach` runs.

The structural root cause is that the codebase has two patterns in conflict:

- **Good pattern** (already used by `Orchestrator`, `StreamEventProcessor`, `NotificationService`): classes receive `Database` via constructor injection.
- **Legacy pattern** (used by `boardHandlers`, `board-tools.ts`, `workspace-context.ts`, and the engines internally): modules call `getDb()` directly wherever they need DB access, relying on a global env-var side effect for test safety.

The fix eliminates the legacy pattern by introducing two new injectable classes and threading `Database` through the entire handler/engine tree from a single call site in `index.ts`.

## Goals / Non-Goals

**Goals:**
- `getDb()` is called exactly once in `index.ts` at app startup; no other production module calls it
- `WorkspaceRepository` replaces the DB-touching module-level functions in `workspace-context.ts`
- `BoardToolExecutor` replaces the free functions in `board-tools.ts`
- All handler factory functions accept `(db: Database, wsRepo: IWorkspaceRepository)`
- `CommonToolContext` carries `boardTools: IBoardToolExecutor` so engines never need `getDb()`
- `bun run dev` defaults to memory DB; `bun run prod` uses the real DB
- README reflects current tooling (removes Electrobun-era ghost scripts)

**Non-Goals:**
- No DB schema changes
- No API contract changes (RPC types unchanged)
- No migration of existing production data
- Not fixing every test file — only `common-tools-registration.test.ts` is the confirmed production-DB toucher; other tests are already safe via `initDb()` + `setupTestConfig()`

## Decisions

### D-1: Two new classes, not one

`WorkspaceRepository` (DB lookups: board/task → workspace key) and `BoardToolExecutor` (board/task CRUD tools) are separate classes rather than merged. They have distinct responsibilities and different consumers — `WorkspaceRepository` is used by handlers, executors, and engines; `BoardToolExecutor` is only consumed via `CommonToolContext` inside engine tool dispatch.

*Alternative considered*: A single `DbServices` god object. Rejected — violates SRP and makes mocking harder in tests.

### D-2: Interface + class pairs (IBroadcastChannel pattern)

Each new class exposes an interface (`IWorkspaceRepository`, `IBoardToolExecutor`) following the existing `IBroadcastChannel` convention. This lets tests inject mocks without a real DB.

*Alternative considered*: Concrete classes only (no interface). Rejected — tests that don't need DB access would still have to construct a real DB or use `initDb()`.

### D-3: Keep free functions in workspace-context.ts for non-DB callers

`getDefaultWorkspaceKey()`, `getWorkspaceConfig()`, `runWithWorkspaceKey()` have no DB dependency and are called from many places. They remain as free functions. Only `getBoardWorkspaceKey(boardId)` and `getTaskWorkspaceKey(taskId)` move into `WorkspaceRepository`.

*Alternative considered*: Convert the entire `workspace-context.ts` to a class. Rejected — unnecessary churn; the pure helpers don't benefit from encapsulation.

### D-4: BoardToolExecutor receives IWorkspaceRepository

`BoardToolExecutor` needs workspace key resolution (e.g. `execMoveTask` calls `getBoardWorkspaceKey`). It receives `IWorkspaceRepository` rather than a raw `Database` for workspace lookups, keeping that responsibility in one class.

### D-5: dev defaults to memory DB; prod is explicit opt-in

`scripts/dev.ts` flips the default: `--real-db` flag is required to use the production database. A new `prod` npm script passes `--real-db` for convenience. Backward compat: `--memory-db` flag still works.

*Alternative considered*: Keep current default, add a warning. Rejected — silent production DB access is the actual bug; making safety the default eliminates the class of problem.

### D-6: Engine constructors gain db + wsRepo

`ClaudeEngine` and `CopilotEngine` currently call `getDb()` lazily inside `execute()`. They gain constructor params `(db: Database, wsRepo: IWorkspaceRepository)` so they can build `CommonToolContext` with `new BoardToolExecutor(db, wsRepo)` at execution time.

*Alternative considered*: Pass `boardTools` through `ExecutionParams`. Rejected — `ExecutionParams` is the AI call boundary; mixing infrastructure dependencies into it blurs the interface.

### D-7: Extract IWorkingDirectoryResolver interface

`WorkingDirectoryResolver` is a class today. `transition-executor.test.ts` uses `StubWorkdirResolver extends WorkingDirectoryResolver` to substitute test behavior. Once `WorkingDirectoryResolver` gains constructor params `(db, wsRepo)`, that `super()` call would need to forward arguments the stub never uses — a type-unsafe hack.

Following the `IBroadcastChannel` pattern already in the codebase, we extract `IWorkingDirectoryResolver { resolve(task: TaskRow): string }`. `WorkingDirectoryResolver` implements it; `StubWorkdirResolver` implements it directly — no inheritance, no `super()`. All consumers (`Orchestrator`, `TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`) type their field as `IWorkingDirectoryResolver`.

*Alternative considered*: Keep the `extends` and pass `db, null as never` to `super()`. Rejected — unsound types and misleading code.

## Risks / Trade-offs

- **Large surface area** — handlers, executors, and both engines all change signatures. Risk of missed call sites. → TypeScript will surface every unresolved import; build must pass before merge.
- **Circular dependency risk** — `WorkspaceRepository` imports from `config/index.ts` (for `getWorkspaceConfig`). → Confirmed safe: `config/index.ts` has no DB import.
- **Test backward compatibility** — tests that currently work via `initDb()` + `setupTestConfig()` still work unchanged; they set `RAILYN_DB=:memory:` which makes `new WorkspaceRepository(getDb())` safe in those files. Only `common-tools-registration.test.ts` needs a structural fix.
- **`logger.ts`, `session-memory.ts`, `git/worktree.ts`** still call `getDb()` — out of scope for this change; noted as follow-up.

## Migration Plan

1. Create `WorkspaceRepository` + `BoardToolExecutor` as new files — no regressions at this step
2. Update `CommonToolContext` to add `boardTools` field — TypeScript breaks all `buildCommonToolContext` call sites, making them easy to find
3. Update handler factory functions to accept `(db, wsRepo)` — `index.ts` compile errors guide wiring
4. Update `Orchestrator` constructor and executor classes to receive `wsRepo`
5. Update engine constructors (`ClaudeEngine`, `CopilotEngine`)
6. Fix `common-tools-registration.test.ts`
7. Flip `scripts/dev.ts` default + add `prod` script to `package.json`
8. Update README
9. Run `bun test src/bun --timeout 20000` — must pass (minus pre-existing failures)

Rollback: entirely additive until step 2; after that TypeScript errors act as the rollback gate.

## Open Questions

- `logger.ts` and `session-memory.ts` both call `getDb()` directly and are not in scope. File a follow-up task?
- `git/worktree.ts` has 5 direct `getDb()` calls — also out of scope but worth noting for a future DI sweep.
