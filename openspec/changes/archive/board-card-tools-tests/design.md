## Context

The `board-card-tools` change renames 7 board tools (task_* → card_*), adds `list_boards`, changes tool group names, and updates error messages. The test suite needs to mirror these changes exactly. The codebase already uses DI patterns that make all components testable without code changes for testability.

## Goals / Non-Goals

**Goals:**
- Every renamed tool has at least one positive test proving correct routing
- `list_boards` has full test coverage (success, empty, group membership)
- Chat-context board tool usage is tested (the core new capability)
- Error message changes are verified
- All RPC scenario tests pass with new tool names
- Tool registry tests reflect new group names

**Non-Goals:**
- No new Playwright tests — UI rendering is covered by existing tool-rendering.spec.ts patterns
- No changes to test infrastructure — existing `commonCtx()`, `initDb()`, `seedProjectAndTask()` patterns are sufficient
- No parallel test code paths — all tests use production code

## Decisions

### 1. All tests in `tasks-tools.test.ts` — no new test files
**Why:** The existing file already tests every board tool exhaustively with the `executeCommonTool()` pattern. Adding new tests here keeps related tests co-located. The file is well-organized by tool name — card-named tools fit naturally.

### 2. Chat-context tests use `commonCtx({ boardId: undefined })`
**Why:** This pattern already exists in the codebase (used for `board_id is required` error tests). It sets `ctx.task.boardId = null` which simulates a chat session. With explicit `board_id` in args, board tools succeed — this is the new capability to verify.

### 3. Error message tests use substring matching
**Why:** `expect(result.text).toContain("list_boards")` is the existing pattern for error message tests. No need for exact string matching — the error message format may evolve.

### 4. RPC scenario tests are mechanical renames
**Why:** These tests verify the full RPC pipeline (mock SDK → tool call → stream persistence). The tool name is just a string in the mock step definition — the actual execution logic is tested by unit tests.

### 5. No integration tests for `list_boards` through full RPC pipeline
**Why:** The `list_boards` tool is simple (query boards table → return JSON). Unit tests via `executeCommonTool()` are sufficient. The RPC scenario tests already prove the pipeline works for all common tools — adding a specific `list_boards` scenario adds no value.

## Risks / Trade-offs

[Risk] Renaming 40+ test assertions could introduce typos → Mitigation: Use find-and-replace with verification, run tests after each batch of renames.

[Risk] Chat-context tests might pass in unit tests but fail in real chat execution → Mitigation: The chat-executor.test.ts already proves BoardToolExecutor injection works. If unit tests pass, the integration path is proven.

[Risk] Tool registry tests might not catch all renamed references → Mitigation: After renames, run `bun test` and check for any test failures mentioning old tool names.
