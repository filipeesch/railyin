## Why

The `inline-available-boards` change introduces `BoardRepository`, `buildBoardNotFoundError`, and engine constructor changes. Without dedicated test coverage, these components ship untested — no verification of DI contracts, repository queries, error formatting, or workspace scoping. This change creates the full test suite to ensure correctness before the feature ships.

## What Changes

- **New test files**: `board-error-format.test.ts`, `board-repository.test.ts`
- **Updated test files**: `board-tool-executor.test.ts`, `tasks-tools.test.ts`, `list-commands.test.ts`, `engine-registry.test.ts`
- **Updated test infrastructure**: `seedBoards()` helper in `helpers.ts`
- **BREAKING**: ~15 existing engine test files must be updated to pass `BoardRepository(db)` to constructors (required parameter, no default)

## Capabilities

### New Capabilities
- `board-error-format-tests`: Unit tests for the pure `buildBoardNotFoundError` function covering formatting, empty state, edge cases, and idempotency
- `board-repository-tests`: Unit tests for `IBoardRepository` interface and `BoardRepository` implementation covering all CRUD operations, workspace isolation, and interface contracts
- `board-executor-inline-errors`: Integration tests for `BoardToolExecutor` inline board error messages covering workspace scoping, board listing, and mock-based repository verification
- `engine-board-repo-di`: DI contract tests verifying all 4 engines accept `IBoardRepository` and use it for workspace key resolution

### Modified Capabilities
- `board-tool-executor`: Constructor now requires `IBoardRepository` parameter; new inline board error scenarios added
- `engine-common-tools`: Engine tests must pass `BoardRepository` to constructors; `listCommands` workspace resolution now uses `BoardRepository`

## Impact

| Area | Files |
|------|-------|
| New test files | `board-error-format.test.ts`, `board-repository.test.ts` |
| Updated tests | `board-tool-executor.test.ts`, `tasks-tools.test.ts`, `list-commands.test.ts`, `engine-registry.test.ts` |
| Engine tests (~15 files) | All engine test files constructing engines directly |
| Test helpers | `helpers.ts` — add `seedBoards()` |
| No production code changes | Tests only — all production code from `inline-available-boards` |
