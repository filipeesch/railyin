## ADDED Requirements

### Requirement: Handler keys are grouped into domain-scoped modules
The backend handler layer SHALL organize handler keys into domain-scoped modules so that each file has a single responsibility. The modules SHALL be: `tasks.ts` (CRUD + lifecycle), `task-git.ts` (worktree + git ops), `code-review.ts` (hunk decisions + line comments), `todos.ts` (todo CRUD), `models.ts` (model management), `engine.ts` (engine commands).

#### Scenario: All original handler keys remain accessible
- **WHEN** `allHandlers` is assembled in `index.ts` by spreading all domain factories
- **THEN** every handler key that existed before the split SHALL be present and callable with identical behavior

#### Scenario: Each factory accepts only the dependencies it uses
- **WHEN** a handler factory function is called
- **THEN** it SHALL only accept parameters that it actually invokes — no phantom dependencies

#### Scenario: Diff utility functions are in the git module
- **WHEN** code-review handlers need diff parsing
- **THEN** they SHALL import from `src/bun/git/diff-utils.ts`, not from handler files
