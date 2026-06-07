# Tasks: Board Repository Tests

## Phase 1: Test Infrastructure

- [ ] 1.1 Add `seedBoards()` helper to `src/bun/test/helpers.ts`
  - Accept array of `{ key: string; name: string }` entries
  - Return array of board IDs
  - Support multiple workspace keys for cross-workspace isolation tests

- [ ] 1.2 Create `src/bun/test/board-error-format.test.ts`
  - Suite EF-1: Formats board list with multiple boards (2 scenarios)
  - Suite EF-2: Returns no boards message for empty array (1 scenario)
  - Suite EF-3: Handles special characters in board names (1 scenario)
  - Suite EF-4: Deterministic output / idempotency (1 scenario)

- [ ] 1.3 Create `src/bun/test/board-repository.test.ts`
  - Suite BR-1: Interface contract (2 scenarios)
  - Suite BR-2: listByWorkspace (4 scenarios: returns boards, empty, ordered, isolation)
  - Suite BR-3: getById (2 scenarios: known, unknown)
  - Suite BR-4: exists (2 scenarios: true, false)
  - Suite BR-5: getWorkspaceKey (2 scenarios: known, unknown)

## Phase 2: BoardToolExecutor Tests

- [ ] 2.1 Update `board-tool-executor.test.ts` constructor to accept `IBoardRepository`
  - Add `boardRepo` parameter to `BoardToolExecutor` construction
  - Use mock `IBoardRepository` where repository calls need verification

- [ ] 2.2 Add BE-7: Error includes board list when boards exist
  - Seed 2+ boards in workspace
  - Call `execGetBoardSummary` without `board_id`
  - Assert error contains formatted board list

- [ ] 2.3 Add BE-8: Error indicates no boards when workspace is empty
  - Use empty workspace
  - Call `execGetBoardSummary` without `board_id`
  - Assert error contains "no boards available"

- [ ] 2.4 Add BE-9: list_cards error includes board list
  - Call `execListTasks` without `board_id`
  - Assert error format matches

- [ ] 2.5 Add BE-10: create_card error includes board list
  - Call `execCreateTask` without `board_id`
  - Assert error format matches

- [ ] 2.6 Add BE-11: Board queries use BoardRepository (mock-based)
  - Inject mock `IBoardRepository` with tracked `exists()` method
  - Call `execGetBoardSummary` with valid `board_id`
  - Assert `mock.exists(boardId)` was called

- [ ] 2.7 Add BE-12: Board listing uses BoardRepository
  - Inject mock `IBoardRepository` with tracked `listByWorkspace()` method
  - Call `execListBoards`
  - Assert `mock.listByWorkspace(workspaceKey)` was called

- [ ] 2.8 Add BE-13: Error scoped to workspace, not all boards
  - Seed boards in 2 different workspaces
  - Call executor with `ctx.workspaceKey = "ws1"`
  - Assert error lists only ws1 boards

- [ ] 2.9 Add BE-14: Board list ordered by created_at
  - Seed boards with different creation times
  - Assert error message lists boards in ascending order

## Phase 3: Full Stack Tests

- [ ] 3.1 Update `tasks-tools.test.ts`
  - Replace `expect(result.text).toContain("list_boards")` with new format assertions
  - TT-1: get_board_summary error includes board list
  - TT-2: list_cards error includes board list
  - TT-3: create_card error includes board list

- [ ] 3.2 Update `list-commands.test.ts`
  - Inject mock `IBoardRepository` into ClaudeEngine constructor
  - LC-1: Assert `getWorkspaceKey()` is called instead of direct DB query

## Phase 4: Engine DI Tests

- [ ] 4.1 Add ER-DI-5 through ER-DI-8 to `engine-registry.test.ts`
  - ER-DI-5: ClaudeEngine accepts IBoardRepository
  - ER-DI-6: CopilotEngine accepts IBoardRepository
  - ER-DI-7: PiEngine accepts IBoardRepository
  - ER-DI-8: OpenCodeEngine accepts IBoardRepository

- [ ] 4.2 Update ALL existing engine test files (~15 files)
  - Add `BoardRepository(db)` to all engine constructors
  - Files: `pi-engine.test.ts`, `pi-harness.test.ts`, `pi/background-compaction.test.ts`,
    `claude-rpc-scenarios.test.ts`, `copilot-rpc-scenarios.test.ts`,
    `opencode-rpc-scenarios.test.ts`, `stream-pipeline-scenarios.test.ts`,
    `engine-registry.test.ts`, `list-commands.test.ts`, and others

## Phase 5: Validation

- [ ] 5.1 Run `bun test src/bun --timeout 20000` — all backend tests green
- [ ] 5.2 Run `bun run build` — frontend builds without errors
- [ ] 5.3 Run `bun run test:e2e` — Playwright suite passes (no expected changes)