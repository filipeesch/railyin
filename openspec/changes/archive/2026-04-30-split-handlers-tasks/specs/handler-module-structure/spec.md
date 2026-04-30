## ADDED Requirements

### Requirement: Handler factories are domain-scoped
The backend handler layer SHALL be split into domain-scoped modules. Each module SHALL export a single factory function that returns only the handler keys for that domain. No single handler module SHALL register handler keys from more than one domain namespace.

#### Scenario: Each module exports one factory
- **WHEN** a developer opens any file under `src/bun/handlers/`
- **THEN** each file exports exactly one factory function, and that function returns handlers for a single domain namespace (e.g., `todos.*`, `models.*`)

#### Scenario: Handler key completeness
- **WHEN** `index.ts` spreads all handler factories into `allHandlers`
- **THEN** the resulting map contains every key that was previously returned by `taskHandlers()` with no additions or removals

### Requirement: Handler factories accept only their required dependencies
Each handler factory function SHALL accept only the dependencies it actually invokes. A factory SHALL NOT accept parameters it does not use.

#### Scenario: db-only factories (no orchestrator)
- **WHEN** `codeReviewHandlers(db)` and `todoHandlers(db)` are called with only a `Database` instance
- **THEN** they return a valid handler map without requiring an `ExecutionCoordinator`

#### Scenario: Minimal dependency injection
- **WHEN** `taskGitHandlers(db, onTaskUpdated)` is called
- **THEN** it does not require an `orchestrator` parameter because no git-operation handler calls orchestrator methods

### Requirement: Diff utility functions are co-located with git utilities
The functions `readFileDiffContent`, `computeHunkHash`, `parseGitDiffHunks`, and `extractHunkPatch` SHALL reside in `src/bun/git/diff-utils.ts` alongside `worktree.ts`. They SHALL be exported from that module for use by `code-review.ts`.

#### Scenario: diff-utils exports are importable
- **WHEN** `code-review.ts` imports from `../git/diff-utils.ts`
- **THEN** all four functions and the `ParsedHunk` interface are available as named exports

### Requirement: Todo DB layer uses a repository class (true DI)
`src/bun/db/todos.ts` SHALL export a `TodoRepository` class with `db: Database` injected via constructor, replacing the six standalone functions that previously called `getDb()` internally. `engine/common-tools.ts` SHALL receive a `TodoRepository` instance via `CommonToolContext.todoRepo`.

#### Scenario: TodoRepository replaces standalone functions
- **WHEN** `src/bun/db/todos.ts` is opened
- **THEN** it exports a `TodoRepository` class (not standalone functions), and the class methods accept no `db` param (it is bound at construction time)

#### Scenario: CommonToolContext carries todoRepo
- **WHEN** `src/bun/engine/types.ts` is opened
- **THEN** `CommonToolContext` has a `todoRepo: TodoRepository` field, and both engine construction sites (`claude/engine.ts` and `copilot/engine.ts`) set it to `new TodoRepository(db)`

### Requirement: todos handler module uses static imports
The `todoHandlers()` factory SHALL use top-level static imports from `../db/todos.ts` rather than inline `await import()` calls inside handler bodies.

#### Scenario: Static import consistency
- **WHEN** the todos handler file is opened
- **THEN** `TodoRepository` is imported at the top of the file, consistent with every other handler module in the codebase

### Requirement: All existing backend tests pass after the split
The refactoring SHALL NOT break any currently-passing tests. The `handlers.test.ts` `makeHandlers()` helper SHALL be updated to spread all domain handler factories.

#### Scenario: Test suite stays green
- **WHEN** `bun test src/bun/test --timeout 20000` is run after the split
- **THEN** all previously-passing tests continue to pass
