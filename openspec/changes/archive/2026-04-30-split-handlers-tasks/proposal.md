## Why

`src/bun/handlers/tasks.ts` has grown to 1307 lines and contains 6 unrelated domains in a single exported function, making it hard to navigate, reason about, and test in isolation. This refactor separates it into single-responsibility modules aligned with the existing handler pattern.

## What Changes

- **Refactor** `src/bun/db/todos.ts` — replace 6 standalone functions (which called `getDb()` internally) with a `TodoRepository` class (`constructor(private db: Database)`); eliminates the global singleton for the todos DB layer
- **Update** `src/bun/engine/types.ts` — add `todoRepo: TodoRepository` to `CommonToolContext`
- **Update** `src/bun/engine/common-tools.ts` — replace standalone todo function calls with `ctx.todoRepo.*`
- **Update** `src/bun/engine/claude/engine.ts` and `copilot/engine.ts` — inject `new TodoRepository(db)` into the tool context objects
- **Extract** `src/bun/handlers/task-git.ts` — worktree and git operations (`tasks.listBranches`, `tasks.createWorktree`, `tasks.removeWorktree`, `tasks.getGitStat`, `tasks.getChangedFiles`)
- **Extract** `src/bun/handlers/code-review.ts` — hunk decisions and line comments (`tasks.getFileDiff`, `tasks.rejectHunk`, `tasks.decideAllHunks`, `tasks.setHunkDecision`, `tasks.addLineComment`, `tasks.getLineComments`, `tasks.deleteLineComment`, `tasks.writeFile`, `tasks.getPendingHunkSummary`, `tasks.getCheckpointRef`)
- **Extract** `src/bun/handlers/todos.ts` — todo CRUD (`todos.list`, `todos.get`, `todos.create`, `todos.edit`, `todos.delete`)
- **Extract** `src/bun/handlers/models.ts` — model management (`models.list`, `models.setEnabled`, `models.listEnabled`)
- **Extract** `src/bun/handlers/engine.ts` — engine commands (`engine.listCommands`)
- **Shrink** `src/bun/handlers/tasks.ts` to task CRUD and lifecycle only
- **Create** `src/bun/git/diff-utils.ts` — move private diff parsing helpers out of handler layer into the existing `git/` module
- **Cleanup** Remove phantom `onNewMessage` parameter from `taskHandlers()` — it is accepted but never invoked inside the handler body
- **Cleanup** Convert `todos.*` dynamic `await import()` calls to static imports, consistent with every other handler in the codebase
- **Update** `src/bun/index.ts` to spread each new factory separately
- **Update** `src/bun/test/handlers.test.ts` `makeHandlers()` helper to compose all new factories

No handler keys change. No API or behavioral changes.

## Capabilities

### New Capabilities

None — this is a pure structural refactor. No new capabilities are introduced.

### Modified Capabilities

- `task-management`: Internal implementation split across files; no requirement changes
- `code-review`: Internal implementation moved to dedicated module; no requirement changes
- `git-worktree`: Diff parsing utilities relocated to `git/diff-utils.ts`; no requirement changes

## Impact

- `src/bun/handlers/tasks.ts` — shrinks from 1307 lines to ~420 lines
- `src/bun/handlers/task-git.ts` — new file, ~120 lines
- `src/bun/handlers/code-review.ts` — new file, ~330 lines
- `src/bun/handlers/todos.ts` — new file, ~35 lines (uses `TodoRepository`)
- `src/bun/handlers/models.ts` — new file, ~110 lines
- `src/bun/handlers/engine.ts` — new file, ~8 lines
- `src/bun/git/diff-utils.ts` — new file, ~250 lines
- `src/bun/db/todos.ts` — refactored: `TodoRepository` class replaces 6 standalone functions
- `src/bun/engine/types.ts` — `CommonToolContext` gains `todoRepo: TodoRepository`
- `src/bun/engine/common-tools.ts` — 7 todo call sites updated to `ctx.todoRepo.*`
- `src/bun/engine/claude/engine.ts` and `copilot/engine.ts` — context construction updated
- `src/bun/index.ts` — updated imports and `allHandlers` composition
- `src/bun/test/handlers.test.ts` — updated `makeHandlers()` and 4 inline `taskHandlers()` call sites
- No changes to `src/shared/rpc-types.ts`, frontend, or DB schema
