## Why

The `split-handlers-tasks` refactor extracts six domain-scoped handler modules and a new `TodoRepository` class, but ships with zero test coverage for the new module boundaries. Three additional domains have had no tests since they were written: `todos.*` handlers, `code-review.*` handlers, and `engine.*` handlers. The newly merged `validateTransition` function also has no tests. Writing all coverage in one focused task ensures the refactor is verifiably correct and the new module structure is trustworthy going forward.

## What Changes

- **New**: `src/bun/test/transition-validator.test.ts` — 8 unit scenarios covering `validateTransition` (task-not-found, invalid column, at-capacity, allowed_transitions enforcement, free source, success shape)
- **New**: `src/bun/test/diff-utils.test.ts` — 12 unit scenarios covering the four extracted `git/diff-utils.ts` functions (parse, hash, extract — pure + real git tmpdir)
- **New**: `src/bun/test/todo-handlers.test.ts` — 10 unit scenarios covering `todoHandlers(db)` via `TodoRepository` (create, list, get, edit, delete — in-memory DB)
- **New**: `src/bun/test/code-review-handlers.test.ts` — 7 unit scenarios covering `codeReviewHandlers(db)` (hunk decisions, line comments, writeFile, getPendingHunkSummary — real git tmpdir)
- **New**: `src/bun/test/task-git-handlers.test.ts` — 3 unit scenarios covering `taskGitHandlers(db, onTaskUpdated)` (listBranches, createWorktree, getChangedFiles — real git tmpdir)
- **New**: `src/bun/test/model-handlers.test.ts` — 3 unit scenarios covering `modelHandlers(db, orchestrator)` (list, setEnabled, listEnabled — mock orchestrator)
- **New**: `src/bun/test/engine-handlers.test.ts` — 1 unit scenario covering `engineHandlers(orchestrator)` (listCommands — mock orchestrator + null case)
- **New**: `e2e/ui/board-allowed-transitions.spec.ts` — 4 Playwright scenarios covering the `column-allowed-transitions` UI spec (forbidden CSS class, not-allowed cursor, no API call on forbidden drop, allowed columns remain droppable)

## Capabilities

### New Capabilities
- `handler-module-test-coverage`: Unit tests for all six extracted handler modules, diff-utils, transition-validator, and the Playwright spec for allowed transitions UI

### Modified Capabilities
- `backend-test-suite-green`: Test suite now includes 7 new test files; the green-suite contract expands to cover new module boundaries
- `column-allowed-transitions`: Gains corresponding Playwright test coverage (AT-1..AT-4) for the spec scenarios that shipped without tests

## Impact

- `src/bun/test/` — 7 new test files (pure additions, no edits to existing files)
- `e2e/ui/` — 1 new Playwright spec file
- No source code changes — this proposal purely adds tests
- Depends on `split-handlers-tasks` being applied first (the handler modules must exist)
