## 1. Create workflow/tools/ sub-modules

- [x] 1.1 Create `src/bun/workflow/tools/types.ts` — extract only live types: `BoardToolContext`; omit dead types (`ToolContext`, `TaskToolCallbacks`, `WriteResult`, `ShellApprovalDecision`)
- [x] 1.2 Create `src/bun/workflow/tools/board-tools.ts` — implement all 8 board operations (`execGetTask`, `execGetBoardSummary`, `execListTasks`, `execCreateTask`, `execEditTask`, `execDeleteTask`, `execMoveTask`, `execMessageTask`) as standalone async functions accepting `BoardToolContext`; apply all three production bug fixes (D3 card limits, D4 engine model resolution, D5 LSP cleanup)
- [x] 1.3 Create `src/bun/workflow/tools/lsp-tools.ts` — move `executeLspTool` from `tools.ts`; include `safePath` as a private helper (its only remaining caller)
- [x] 1.4 Create `src/bun/workflow/tools/registry.ts` — extract `TOOL_DEFINITIONS` (with dead tool entries for `read_file`, `write_file`, `edit_file`, `multi_replace`, `run_command`, `search_text`, `find_files`, `fetch_url`, `search_internet` removed), `TOOL_GROUPS`, `resolveToolsForColumn`, `getToolDescriptionBlock`

## 2. Update engine/approved-commands.ts

- [x] 2.1 Add `parseShellBinaries(command: string): string[]` to `engine/approved-commands.ts` using inclusive pipe semantics (splits on `&&`, `||`, `;`, `|`); export it

## 3. Update engine adapters

- [x] 3.1 Update `engine/claude/adapter.ts` — remove dead `import { extractCommandBinaries }` (line 5); update `getUnapprovedShellBinaries` to call `parseShellBinaries` from `approved-commands.ts`
- [x] 3.2 Update `engine/common-tools.ts` — replace inline board tool switch cases (`get_task`, `get_board_summary`, `list_tasks`, `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`) with calls to the corresponding `exec*` functions from `board-tools.ts`
- [x] 3.3 Update `engine/common-tools.ts` — update `executeLspTool` import to use `workflow/tools/lsp-tools.ts`

## 4. Replace workflow/tools.ts with barrel

- [x] 4.1 Replace `src/bun/workflow/tools.ts` with a barrel re-export of live symbols only: `executeLspTool`, `resolveToolsForColumn`, `getToolDescriptionBlock`, `TOOL_DEFINITIONS`, `TOOL_GROUPS`, `parseShellBinaries`, `BoardToolContext`; remove dead exports (`executeTool`, `myersDiff`, `extractCommandBinaries`, `WriteResult`, `ShellApprovalDecision`, `ToolContext`, `TaskToolCallbacks`)

## 5. Update test suite

### 5a. Delete dead tests

- [x] 5.1 Delete dead test blocks from `src/bun/test/tools.test.ts` — remove the following `describe` blocks entirely: `myersDiff`, `executeTool / read_file`, `executeTool / read_file partial reads`, `executeTool / read_file — line numbers and header`, `executeTool / run_command`, `executeTool / run_command — approval gate`, `executeTool / write_file`, `executeTool / edit_file`, `executeTool / search_text`, `executeTool / search_text context_lines`, `executeTool / find_files`, `executeTool / fetch_url`, `executeTool / search_internet`, `executeTool / unknown`, `extractCommandBinaries`; keep `resolveToolsForColumn` describe block unchanged (~6 tests, line 394+)

### 5b. Migrate board tool tests to live path

Migration mechanics for every `executeTool` call in board tests:
- `JSON.stringify({ k: v })` → `{ k: String(v) }` (flat string map, numeric values become strings)
- `ctx()` → `commonCtx()` (already defined in the file)
- `result as string` → `result.text`
- Callback tracking shape: `taskCallbacks.handleTransition` → `onTransition`; `taskCallbacks.handleHumanTurn` → `onHumanTurn`; `taskCallbacks.cancelExecution` → `onCancel`

- [x] 5.2 Migrate `src/bun/test/tasks-tools.test.ts` — apply migration mechanics above to all 8 board tool `describe` blocks (`get_task`, `get_board_summary`, `list_tasks`, `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`); `TOOL_GROUPS` tests and all `executeCommonTool` todo tests are unchanged; remove `import { executeTool }` and `import type { TaskToolCallbacks }` once no callers remain
- [x] 5.3 Migrate `src/bun/test/column-groups.test.ts` — apply migration mechanics to the 2 card-limit `executeTool("move_task", ...)` calls in the `card limit enforcement in move_task` describe block (lines 238–276); `tasks.transition` tests and position rebalancing tests are already on the live path — leave them unchanged

### 5c. New tests for production bug fixes

- [x] 5.4 Add `src/bun/test/approved-commands.test.ts` — unit tests for `parseShellBinaries` covering: single binary (`"git status"` → `["git"]`), `&&` compound (`"cd src && bun test && git diff"` → `["cd","bun","git"]`), deduplication (`"git add . && git commit"` → `["git"]`), pipe receiver (`"bun test | cat"` → `["bun","cat"]`), `||` operator, `;` separator; 6 tests total
- [x] 5.5 Add LSP cleanup test to `src/bun/test/tasks-tools.test.ts` `delete_task` describe block — seed the registry via `(taskLspRegistry as any).entries.set(String(taskId), { manager: null, idleTimer: null, serverConfigs: [], worktreePath: "" })`, call `executeCommonTool("delete_task", ...)`, assert `(taskLspRegistry as any).entries.has(String(taskId))` is `false`; add `(taskLspRegistry as any).entries.delete(String(taskId))` to `afterEach` cleanup to prevent cross-test pollution
- [x] 5.6 Add position ordering tests to `src/bun/test/tasks-tools.test.ts` `move_task` describe block — (a) "places task at position 500 when column is empty": call `executeCommonTool("move_task", ...)`, query `SELECT position FROM tasks WHERE id = ?`, expect `500`; (b) "places task at top of column (MIN/2)": seed a second task in the target column at `position = 1000` via direct DB insert, move, expect `position = 500`; (c) edge case: seed at `position = 2`, expect `position = 1`; these tests would fail against the current broken `common-tools.ts` (`position` default is `0`) and pass against the fixed `board-tools.ts`

### 5d. Fix adapter test

- [x] 5.7 Update `src/bun/test/claude-adapter.test.ts` — change pipe receiver test expectation: `getUnapprovedShellBinaries("git status && bun test | cat", ["git"])` currently expects `["bun"]`; change to `["bun", "cat"]` (inclusive pipe semantics — `cat` is a pipe receiver and now requires approval)

### 5e. Final run

- [x] 5.8 Run full backend test suite (`bun test src/bun/test --timeout 20000`) and fix any failures

## 6. Verification

- [x] 6.1 Confirm `workflow/tools.ts` is ≤ 40 lines (barrel only, live exports only)
- [x] 6.2 Confirm no file in `workflow/tools/` exceeds 400 lines
- [x] 6.3 Confirm `extractCommandBinaries` dead import is gone from `claude/adapter.ts`
- [x] 6.4 Confirm `executeTool`, `myersDiff`, `WriteResult`, `ShellApprovalDecision` are not exported from the barrel
- [x] 6.5 Confirm `approved-commands.test.ts` exists and all 6 `parseShellBinaries` tests pass
- [x] 6.6 Confirm LSP cleanup test and position ordering tests (3) are present in `tasks-tools.test.ts`
- [x] 6.7 Run full backend test suite green: `bun test src/bun/test --timeout 20000`
