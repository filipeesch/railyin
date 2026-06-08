# Tasks: Board Repository Tests

## Phase 1: Test Infrastructure

- [x] 1.1 Add `seedBoards()` helper to `src/bun/test/helpers.ts`
  - Accept array of `{ key: string; name: string }` entries
  - Return array of board IDs
  - Support multiple workspace keys for cross-workspace isolation tests

- [x] 1.2 Create `src/bun/test/board-error-format.test.ts`
  - Suite EF-1: Formats board list with multiple boards (2 scenarios)
  - Suite EF-2: Returns no boards message for empty array (1 scenario)
  - Suite EF-3: Handles special characters in board names (1 scenario)
  - Suite EF-4: Deterministic output / idempotency (1 scenario)

- [x] 1.3 Create `src/bun/test/board-repository.test.ts`
  - Suite BR-1: Interface contract (2 scenarios)
  - Suite BR-2: listByWorkspace (4 scenarios: returns boards, empty, ordered, isolation)
  - Suite BR-3: getById (2 scenarios: known, unknown)
  - Suite BR-4: exists (2 scenarios: true, false)
  - Suite BR-5: getWorkspaceKey (2 scenarios: known, unknown)

## Phase 2: BoardToolExecutor Tests

- [x] 2.1 Update `board-tool-executor.test.ts` constructor to accept `IBoardRepository`
- [x] 2.2 Add BE-7: Error includes board list when boards exist
- [x] 2.3 Add BE-8: Error indicates no boards when workspace is empty
- [x] 2.4 Add BE-9: list_cards error includes board list
- [x] 2.5 Add BE-10: create_card error includes board list
- [x] 2.6 Add BE-11: Board queries use BoardRepository (mock-based)

- [x] 2.7 Add BE-12: Board listing uses BoardRepository
- [x] 2.8 Add BE-13: Error scoped to workspace, not all boards
- [x] 2.9 Add BE-14: Board list ordered by created_at

## Phase 3: Full Stack Tests

- [x] 3.1 Update `tasks-tools.test.ts`
- [x] 3.2 Update `list-commands.test.ts`

## Phase 4: Engine DI Tests

- [x] 4.1 Add ER-DI-5 through ER-DI-8 to `engine-registry.test.ts` (mechanical - constructor accepts parameter)
- [x] 4.2 Update ALL existing engine test files (~15 files) (mechanical - add `new BoardRepository(db)` to constructors)

## Phase 5: Validation

- [ ] 5.1 Run `bun test src/bun --timeout 20000` — all backend tests green
- [ ] 5.2 Run `bun run build` — frontend builds without errors
- [ ] 5.3 Run `bun run test:e2e` — Playwright suite passes (no expected changes)