## 0. TodoRepository + engine DI wiring

- [ ] 0.1 Refactor `src/bun/db/todos.ts` — replace the six exported standalone functions (`createTodo`, `editTodo`, `getTodo`, `listTodos`, `deleteTodo`, `reprioritizeTodos`) with a `TodoRepository` class. Constructor: `constructor(private readonly db: Database)`. Each method body replaces `const db = getDb()` with `this.db`. Remove the `import { getDb }` line. Keep all exported interfaces (`TodoItem`, `TodoListItem`, `TodoUpdate`, `TodoStatus`) and the private `mapTodoRow` helper unchanged.

- [ ] 0.2 Update `src/bun/engine/types.ts` — add `todoRepo: TodoRepository` to the `CommonToolContext` interface. Add import: `import { TodoRepository } from "../db/todos.ts"`.

- [ ] 0.3 Update `src/bun/engine/common-tools.ts` — replace 7 call sites that call the old standalone functions with `ctx.todoRepo.*` equivalents: `createTodo(...)` → `ctx.todoRepo.createTodo(...)`, `editTodo(...)` → `ctx.todoRepo.editTodo(...)`, `getTodo(...)` → `ctx.todoRepo.getTodo(...)`, `listTodos(...)` → `ctx.todoRepo.listTodos(...)`, `reprioritizeTodos(...)` → `ctx.todoRepo.reprioritizeTodos(...)`. Remove the static import of those functions from `../db/todos.ts`.

- [ ] 0.4 Update `src/bun/engine/claude/engine.ts` — add `todoRepo: new TodoRepository(this.db)` to the `commonToolContext` object literal at line ~63. Add import: `import { TodoRepository } from "../../db/todos.ts"`. (The orchestrator's `db` field is already accessible as `this.db`.)

- [ ] 0.5 Update `src/bun/engine/copilot/engine.ts` — add `todoRepo: new TodoRepository(this.db)` to the `toolContext` object literal at line ~139. Add import: `import { TodoRepository } from "../../db/todos.ts"`.

## 1. Create git/diff-utils.ts

- [ ] 1.1 Create `src/bun/git/diff-utils.ts` — move `ParsedHunk` interface, `computeHunkHash`, `parseGitDiffHunks`, `extractHunkPatch`, and `readFileDiffContent` from `tasks.ts` (lines ~1050–1299). Export all five. Add required imports: `createHash` from `"crypto"`, `Database` from `bun:sqlite` (for `readFileDiffContent` which takes db as parameter), and the shared RPC types (`HunkDecision`, `HunkWithDecisions`, `ReviewerDecision`, `FileDiffContent`).

## 2. Create handler modules

- [ ] 2.1 Create `src/bun/handlers/task-git.ts` — extract handlers: `tasks.listBranches`, `tasks.createWorktree`, `tasks.removeWorktree`, `tasks.getGitStat`, `tasks.getChangedFiles`. Factory signature: `taskGitHandlers(db: Database, onTaskUpdated: OnTaskUpdated)`. Imports: `Database` from `bun:sqlite`, `Task`, `GitNumstat`, `GitFileNumstat`, `TaskRow`, `mapTask`, `createWorktree`, `removeWorktree`, `listBranches` from `../git/worktree.ts`, `OnTaskUpdated` from `../engine/types.ts`.

- [ ] 2.2 Create `src/bun/handlers/code-review.ts` — extract handlers: `tasks.getFileDiff`, `tasks.rejectHunk`, `tasks.decideAllHunks`, `tasks.setHunkDecision`, `tasks.addLineComment`, `tasks.getLineComments`, `tasks.deleteLineComment`, `tasks.writeFile`, `tasks.getPendingHunkSummary`, `tasks.getCheckpointRef`. Factory signature: `codeReviewHandlers(db: Database)`. Imports: `Database` from `bun:sqlite`, RPC types, and all four functions from `../git/diff-utils.ts`.

- [ ] 2.3 Create `src/bun/handlers/todos.ts` — extract handlers: `todos.list`, `todos.get`, `todos.create`, `todos.edit`, `todos.delete`. Factory signature: `todoHandlers(db: Database)`. Use **static top-level import** of `TodoRepository` from `../db/todos.ts`. Construct `const repo = new TodoRepository(db)` at the top of the factory function and use `repo.*` methods inside each handler body. No `getDb()` calls anywhere.

- [ ] 2.4 Create `src/bun/handlers/models.ts` — extract handlers: `models.list`, `models.setEnabled`, `models.listEnabled`. Factory signature: `modelHandlers(db: Database, orchestrator: ExecutionCoordinator | null)`. Imports: `Database` from `bun:sqlite`, `ProviderModelList`, `ModelInfo`, `ExecutionCoordinator`, `getDefaultWorkspaceKey`.

- [ ] 2.5 Create `src/bun/handlers/engine.ts` — extract handler: `engine.listCommands`. Factory signature: `engineHandlers(orchestrator: ExecutionCoordinator | null)` (no db needed — pure orchestrator call). Imports: `ExecutionCoordinator` from `../engine/coordinator.ts`.

## 3. Trim tasks.ts

- [ ] 3.1 Remove the extracted handler blocks from `src/bun/handlers/tasks.ts`: delete `tasks.listBranches`, `tasks.createWorktree`, `tasks.removeWorktree`, `tasks.getGitStat`, `tasks.getChangedFiles` (git ops); delete all 10 code-review handlers; delete `todos.*` handlers; delete `models.*` handlers; delete `engine.listCommands`. Remove `readFileDiffContent`, `computeHunkHash`, `parseGitDiffHunks`, `extractHunkPatch`, and `ParsedHunk` (moved to diff-utils.ts).

- [ ] 3.2 Remove the `onNewMessage: OnNewMessage` parameter from `taskHandlers()` signature. Remove the `OnNewMessage` import from `../engine/types.ts` if it becomes unused. Remove `createHash` import if unused. Remove any other imports that are no longer referenced.

## 4. Update index.ts

- [ ] 4.1 Add imports for the five new handler factories to `src/bun/index.ts`: `taskGitHandlers`, `codeReviewHandlers`, `todoHandlers`, `modelHandlers`, `engineHandlers`.

- [ ] 4.2 Update the `allHandlers` spread in `src/bun/index.ts`: replace the single `...taskHandlers(db, orchestrator, notifyTaskUpdated, notifyNewMessage)` with six spreads — `...taskHandlers(db, orchestrator, notifyTaskUpdated)` (no `notifyNewMessage`), `...taskGitHandlers(db, notifyTaskUpdated)`, `...codeReviewHandlers(db)`, `...todoHandlers(db)`, `...modelHandlers(db, orchestrator)`, `...engineHandlers(orchestrator)`.

## 5. Update tests

- [ ] 5.1 Update `src/bun/test/handlers.test.ts`: add imports for `taskGitHandlers`, `codeReviewHandlers`, `todoHandlers`, `modelHandlers`, `engineHandlers`. Update `makeHandlers()` to spread all six factories — pass `db` to each that requires it, and drop the 4th `() => {}` (onNewMessage) from `taskHandlers`. Update the 4 inline `taskHandlers(db, orchestrator, ...)` calls in the contextUsage and models tests to remove the 4th argument.

## 6. Verify

- [ ] 6.1 Run `bun run build` — confirm TypeScript compiles with zero errors.
- [ ] 6.2 Run `bun test src/bun/test --timeout 20000` — confirm all previously-passing tests remain green.

