# Tasks: Inline Available Boards

## Phase 1: Repository & Error Format

- [x] 1.1 Create `src/bun/db/board-repository.ts` with `IBoardRepository` interface and `BoardRepository` class
- [x] 1.2 Create `src/bun/workflow/tools/board-error-format.ts` with `buildBoardNotFoundError` pure function

## Phase 2: BoardToolExecutor Integration

- [x] 2.1 Update `BoardToolExecutor` constructor to accept `IBoardRepository`
- [x] 2.2 Replace 3 direct board queries in `BoardToolExecutor` with `boardRepo` calls:
  - `execGetBoardSummary`: board existence check → `boardRepo.exists()`
  - `execCreateTask`: board lookup → `boardRepo.getById()`
  - `execListBoards`: list boards → `boardRepo.listByWorkspace()`
- [x] 2.3 Replace hardcoded error strings with `buildBoardNotFoundError(boardRepo.listByWorkspace(ctx.workspaceKey))`
- [x] 2.4 Update `execGetBoardSummary` to use `boardRepo.exists()` instead of direct query

## Phase 3: Orchestrator Wiring

- [x] 3.1 Create `BoardRepository(db)` in orchestrator constructor
- [x] 3.2 Pass `boardRepo` to `BoardToolExecutor` constructor

## Phase 4: Engine Injection

- [x] 4.1 Update `EngineFactory` type signature in `index.ts` to include `boardRepo: IBoardRepository`
- [x] 4.2 Update all 4 factory closures to pass `boardRepo` to engine constructors
- [x] 4.3 Update `ClaudeEngine` constructor to accept `boardRepo`, replace direct DB query in `listCommands`
- [x] 4.4 Update `CopilotEngine` constructor to accept `boardRepo`, replace direct DB query
- [x] 4.5 Update `PiEngine` constructor to accept `boardRepo`, replace direct DB queries
- [x] 4.6 Update `OpenCodeEngine` constructor to accept `boardRepo`, replace direct DB query

## Phase 5: Tests

> Test coverage is captured in a **separate OpenSpec change** (`board-repository-tests`).
> See that change for the full test plan (20+ scenarios across unit, integration, and DI tests).

- [x] 5.1 Coordinate with `board-repository-tests` change for test file dependencies
- [x] 5.2 Run `bun test src/bun --timeout 20000` — pre-existing failures (missing deps), not related to this change
- [x] 5.3 Run `bun run test:e2e` — Playwright suite passes (no expected changes)
