## Context

The `inline-available-boards` change introduces `BoardRepository`, `buildBoardNotFoundError`, and engine constructor changes. The test suite follows the existing project patterns: vitest for unit/integration tests with in-memory DB, Playwright for UI tests (mocked API).

**Current test patterns:**
- Repository tests: `workspace-repository.test.ts` — in-memory DB + `initDb()` + interface contract checks
- Executor tests: `board-tool-executor.test.ts` — real repos + in-memory DB
- Engine tests: Use mock SDK adapters + `initDb()` + `setupTestConfig()`

## Goals / Non-Goals

**Goals:**
- Full unit test coverage for `BoardRepository` (12 scenarios)
- Full unit test coverage for `buildBoardNotFoundError` (4 scenarios)
- Integration tests for inline board error messages (8 scenarios)
- DI contract tests for all 4 engines (4 scenarios)
- All mocking via dependency injection — no conditional code paths

**Non-Goals:**
- Playwright tests (feature is AI-facing, not UI-rendered)
- Performance benchmarks
- Test infrastructure refactoring beyond `seedBoards()` helper

## Decisions

### D1: All mocking via dependency injection
No test flags, no conditional code paths, no `if (process.env.TEST)` branches. Tests inject mock `IBoardRepository` implementations via constructor. Production code and tests use the same constructor signature.

### D2: `seedBoards()` helper in `helpers.ts`
Follows the existing `seedProjectAndTask()` pattern. Reduces boilerplate for multi-board test scenarios. Scoped to test infrastructure only.

### D3: Required `boardRepo` parameter (no default)
Engine constructors require `IBoardRepository` — no fallback to `getDb()`. All ~15 existing engine test files must be updated. This is mechanical but broad; the benefit is clean DI with no untested fallback paths.

### D4: No Playwright tests
Inline board errors are tool results consumed by the AI model, not UI-rendered content. Playwright tests mock the API layer and cannot test backend tool execution. Full coverage achieved via unit + integration tests.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| ~15 engine test files break when `boardRepo` becomes required | Mechanical update: pass `new BoardRepository(db)` to each constructor. Run tests incrementally per file. |
| Mock `IBoardRepository` behavior diverges from real implementation | Mock only tracks calls; real `BoardRepository` tests use in-memory DB for query correctness. |
| Cross-workspace isolation tests require multi-workspace setup | `seedBoards()` helper supports multiple workspace keys. Tests seed 2+ workspaces explicitly. |
