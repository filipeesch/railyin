## Context

`src/bun/handlers/tasks.ts` is ~1300 lines. One exported function `taskHandlers()` returns ~40 handler keys spanning task CRUD, git operations, code review hunks, todos, models, and engine commands. Alongside the handler body sit four private diff-parsing utilities (`readFileDiffContent`, `computeHunkHash`, `parseGitDiffHunks`, `extractHunkPatch`) that belong conceptually in the existing `src/bun/git/` module.

The existing handler pattern (boards, workspace, conversations, etc.) uses one exported factory function per file, each receiving only the dependencies it needs. `tasks.ts` pre-dates this pattern and was never split.

After a recent main-branch merge (`perf: optimize DB writes`), the entire handler layer was refactored to inject `db: Database` as the first parameter of every factory, eliminating module-level `getDb()` calls. The current signature is `taskHandlers(db, orchestrator, onTaskUpdated, onNewMessage)`. All new modules must follow this pattern.

Additionally, a new `src/bun/handlers/position-service.ts` module was extracted with `PositionService` (encapsulating `rebalanceColumnPositions` and `reorderColumn`). `tasks.ts` now imports and uses `PositionService` — this is already done and should not be re-extracted.

All handler keys are routed through `allHandlers` in `src/bun/index.ts` via object spread — the router is fully agnostic about how many factories produce the keys. Splitting is transparent to the API.

## Goals / Non-Goals

**Goals:**
- Split `tasks.ts` into 6 single-responsibility handler modules
- Move diff-parsing utilities to `src/bun/git/diff-utils.ts`
- Remove phantom `onNewMessage` parameter (accepted but never used in handler body)
- Convert `todos.*` dynamic `await import()` calls to static imports
- Keep all ~40 handler keys identical (zero API changes)
- Keep `handlers.test.ts` green

**Non-Goals:**
- Changing any handler logic or behavior
- Moving `extractChips` cross-layer import (intentional codebase pattern, separate concern)
- Adding new tests for the new module boundaries
- Changing the `Orchestrator` vs `ExecutionCoordinator` type inconsistency across handlers

## Decisions

### D1: Minimal dependency injection per factory

Each factory accepts only the dependencies it actually uses, following Interface Segregation Principle. `db: Database` is the first parameter of all handler factories (established codebase pattern post-merge):

```
taskHandlers(db, orchestrator, onTaskUpdated)      // remove phantom onNewMessage
taskGitHandlers(db, onTaskUpdated)                 // no orchestrator
codeReviewHandlers(db)                             // only db
todoHandlers(db)                                   // only db
modelHandlers(db, orchestrator)                    // needs db for enabled_models queries
engineHandlers(orchestrator)                       // no db needed (orchestrator only)
```

**Alternative considered:** Uniform signature (all receive all deps for consistency). Rejected — would carry phantom dependencies into modules that don't use them, violating ISP and obscuring what each module actually needs.

### D2: Diff utilities in `src/bun/git/diff-utils.ts`

`readFileDiffContent`, `computeHunkHash`, `parseGitDiffHunks`, `extractHunkPatch` and the `ParsedHunk` interface move to a new file in the existing `git/` module.

`readFileDiffContent` accepts `db` as a parameter (it doesn't call `getDb()` at module level), so it fits cleanly without introducing module-level side effects.

**Alternative considered:** Keeping them private in `code-review.ts`. Rejected — `code-review.ts` would still be ~580 lines mixing handler logic with git CLI parsing. The `git/` module is the semantic home for git output parsing.

### D3: Static imports for `todos.ts`

The current dynamic `await import("../db/todos.ts")` inside each handler body is inconsistent with every other handler file. The new `handlers/todos.ts` uses static top-level imports.

No circular dependency exists between handlers and db/todos, so there is no technical reason for the dynamic pattern.

Note: `todos.ts` no longer needs `getDb()` since `db` is now injected, consistent with the new codebase-wide pattern.

### D4: Update test `makeHandlers()` helper (no re-export facade)

`handlers.test.ts` calls `handlers["models.listEnabled"]` through the `taskHandlers()` result. After the split this key lives in `modelHandlers()`. The `makeHandlers()` test helper is updated to spread all factories.

**Alternative considered:** A backwards-compat re-export facade in `tasks.ts`. Rejected — it defeats the split, makes `tasks.ts` a god-object facade, and tests wouldn't validate actual module boundaries.

### D5: Handler key namespace stays `tasks.*` for git and review ops

The split is internal. Handler keys like `tasks.getFileDiff`, `tasks.createWorktree`, etc., remain unchanged. The `tasks.*` prefix is part of the API contract with the frontend, not a reflection of the file that implements them.

### D6: TodoRepository class (PositionService pattern)

`src/bun/db/todos.ts` standalone functions all call `getDb()` internally. If `todoHandlers(db)` used them as-is, `db` would be a phantom parameter — the exact anti-pattern this refactor eliminates.

The existing `PositionService` class in `src/bun/handlers/position-service.ts` establishes the correct pattern: `constructor(private readonly db: Database)`. `TodoRepository` follows it identically.

```ts
// db/todos.ts
export class TodoRepository {
  constructor(private readonly db: Database) {}
  createTodo(taskId, number, title, description, phase?) { this.db.run(...) }
  editTodo(taskId, id, update) { this.db.run(...) }
  getTodo(taskId, id): TodoItem | { deleted: true; message: string } | null { ... }
  listTodos(taskId, includeDeleted?, currentPhase?) { ... }
  deleteTodo(taskId, id) { ... }
  reprioritizeTodos(taskId, items) { ... }
}
```

`todoHandlers(db)` constructs `new TodoRepository(db)` and calls its methods — true DI, no `getDb()`.

`engine/common-tools.ts` also calls these functions (agent tool execution). `CommonToolContext` gains a `todoRepo: TodoRepository` field. Both engine construction sites (`claude/engine.ts` and `copilot/engine.ts`) set it to `new TodoRepository(db)`.

**Alternative considered:** Optional `db` param with `getDb()` fallback. Rejected — obscures intent and keeps the global singleton call path alive. **Clean break** — no backward-compat wrapper functions.

## Risks / Trade-offs

- **Test coverage gap for module boundaries** — tests run against the composed `allHandlers` object, not individual factories. A factory that accidentally imports wrong deps would still pass tests. → Mitigation: TypeScript will catch missing/extra params at the call sites in `index.ts` and test file.

- **File proliferation** — 6 handler files instead of 1. → Acceptable: each file is now ~35–420 lines, well within the project's existing handler range (45–206 lines for the non-tasks handlers).

- **`onNewMessage` removal** — removing a parameter from a public function signature is a minor breaking change for anything calling `taskHandlers()` with 3 args. → Only 5 call sites exist (4 in test file, 1 in index.ts), all updated in the same PR.

## Module Structure Reference

```
src/bun/handlers/
├── tasks.ts          ~420 lines  list, reorder, reorderColumn, create, transition,
│                                 sendMessage, retry, setModel, contextUsage, compact,
│                                 cancel, update, delete, sessionMemory,
│                                 respondShellApproval, setShellAutoApprove
│                                 Private: fetchTaskWithDetail
│                                 (PositionService already extracted to position-service.ts)
├── task-git.ts       ~120 lines  listBranches, createWorktree, removeWorktree,
│                                 getGitStat, getChangedFiles
├── code-review.ts    ~330 lines  getFileDiff, rejectHunk, decideAllHunks,
│                                 setHunkDecision, addLineComment, getLineComments,
│                                 deleteLineComment, writeFile, getPendingHunkSummary,
│                                 getCheckpointRef
├── todos.ts           ~35 lines  list, get, create, edit, delete
│                                 Uses new TodoRepository(db) — no getDb()
├── models.ts         ~110 lines  list, setEnabled, listEnabled
└── engine.ts           ~8 lines  listCommands

src/bun/git/
├── worktree.ts       (existing, unchanged)
└── diff-utils.ts     ~250 lines  readFileDiffContent, computeHunkHash,
                                  parseGitDiffHunks, extractHunkPatch, ParsedHunk

src/bun/db/
└── todos.ts          ~200 lines  TodoRepository class (replaces 6 standalone functions)
                                  Exports: TodoRepository, TodoItem, TodoListItem,
                                  TodoUpdate, TodoStatus

src/bun/engine/
└── types.ts          (updated)   CommonToolContext gains todoRepo: TodoRepository
```

## Migration Plan

Pure in-place refactor — no DB migrations, no frontend changes, no config changes.

1. Refactor `src/bun/db/todos.ts` — replace 6 standalone functions with `TodoRepository` class; add `db: Database` constructor; all methods use `this.db.*` (no `getDb()`)
2. Update `src/bun/engine/types.ts` — add `todoRepo: TodoRepository` to `CommonToolContext` interface
3. Update `src/bun/engine/common-tools.ts` — replace 7 `createTodo/editTodo/getTodo/listTodos/reprioritizeTodos` call sites with `ctx.todoRepo.*`
4. Update `src/bun/engine/claude/engine.ts` — add `todoRepo: new TodoRepository(db)` to `commonToolContext` object
5. Update `src/bun/engine/copilot/engine.ts` — add `todoRepo: new TodoRepository(db)` to `toolContext` object
6. Create `src/bun/git/diff-utils.ts` — move `ParsedHunk` interface, `computeHunkHash`, `parseGitDiffHunks`, `extractHunkPatch`, and `readFileDiffContent` from `tasks.ts` (lines ~1050–1299). Export all five. Add required imports: `createHash` from `"crypto"`, `Database` from `bun:sqlite` (for `readFileDiffContent` which takes db as parameter), and the shared RPC types (`HunkDecision`, `HunkWithDecisions`, `ReviewerDecision`, `FileDiffContent`).
7. Create new handler modules one at a time, copying code from `tasks.ts`. Each receives `db` as first param per codebase pattern.
8. Update `tasks.ts` — remove moved code and the `onNewMessage` param
9. Update `src/bun/index.ts` — new imports + split spreads in `allHandlers` (each with `db` first)
10. Update `src/bun/test/handlers.test.ts` — `makeHandlers()` and inline call sites (pass `db`, drop `onNewMessage`)
11. Run `bun test src/bun/test --timeout 20000` — must stay green

No rollback complexity: this is a local file restructure with no external system changes.

## Open Questions

None — all design decisions resolved through pre-implementation review.
