## Why

`src/bun/workflow/tools.ts` has grown to 2039 lines bundling 5+ unrelated concerns (diff algorithm, tool schemas, registry, dispatcher, LSP) into one module. This makes individual tool categories untestable in isolation, causes every new tool to touch the same giant switch statement, and has allowed a silent production divergence where the live tool executor (`engine/common-tools.ts`) has weaker — in some cases broken — behavior compared to the tested-but-dead `workflow/tools.ts` path.

## What Changes

- **Delete dead tool implementations**: `read_file`, `write_file`, `edit_file`, `multi_replace`, `run_command`, `search_text`, `find_files`, `fetch_url`, and `search_internet` were part of a native engine that no longer exists. Their implementations, their `TOOL_DEFINITIONS` entries, and all related helpers (`myersDiff`, `applyOneReplacement`, `safePath`, `isPrivateIp`) are removed entirely. Their tests are deleted.
- **Split what remains of `workflow/tools.ts`** into focused sub-modules under `src/bun/workflow/tools/`: `types.ts` (live types only), `board-tools.ts`, `lsp-tools.ts`, `registry.ts`. The original `tools.ts` becomes a thin re-export barrel.
- **Deduplicate board tools**: `board-tools.ts` becomes the single source of truth for all 8 board operations (`get_task`, `get_board_summary`, `list_tasks`, `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`). `engine/common-tools.ts` delegates to it instead of carrying its own copies.
- **Fix silent production bugs** discovered during the deduplication audit:
  - `move_task`: add card limit enforcement and position ordering (missing in prod, present in tested-but-dead path)
  - `create_task`: add engine-level model resolution before workspace default (missing in prod)
  - `delete_task`: add LSP registry cleanup on deletion (missing in tested-but-dead path, present in prod)
- **Consolidate shell binary extraction**: replace dead `extractCommandBinaries` (workflow/tools.ts) and live `getUnapprovedShellBinaries` (claude/adapter.ts) with a single `parseShellBinaries` function in `engine/approved-commands.ts`, engine-agnostic and available to all engines. **BREAKING** (behavior): pipe receivers now require approval (inclusive semantics).
- **Move `executeLspTool`** to `src/bun/workflow/tools/lsp-tools.ts`.
- **Clean test suite**: delete tests for removed dead code; migrate board tool tests from dead `executeTool` to live `executeCommonTool` / `board-tools.ts` functions.

## Capabilities

### New Capabilities

_None_ — this change is a structural refactor with one behavior correction. No new user-facing capabilities are introduced.

### Modified Capabilities

- `shell-command-approval`: Pipe receivers in shell commands (e.g., `bun test | cat`) now **require approval**. The current spec explicitly excludes pipe receivers from the binary list; this change inverts that rule so the unified `parseShellBinaries` function uses inclusive semantics (splitting on `|` as well as `&&`, `||`, `;`).

## Impact

- **`src/bun/workflow/tools.ts`** — replaced with barrel re-export (~30 lines, dead exports removed)
- **`src/bun/workflow/tools/`** — new directory with 4 new files (`types.ts`, `board-tools.ts`, `lsp-tools.ts`, `registry.ts`)
- **`src/bun/engine/common-tools.ts`** — board tool cases replaced with imports from `board-tools.ts`
- **`src/bun/engine/approved-commands.ts`** — gains `parseShellBinaries` (engine-agnostic)
- **`src/bun/engine/claude/adapter.ts`** — dead `extractCommandBinaries` import removed; `getUnapprovedShellBinaries` updated to call `parseShellBinaries`
- **`src/bun/test/tools.test.ts`** — dead tool tests deleted; registry/TOOL_GROUPS tests kept
- **`src/bun/test/tasks-tools.test.ts`** — board tests migrated from dead `executeTool` to live path
- **`src/bun/test/claude-adapter.test.ts`** — pipe receiver test expectation updated
- **`src/bun/test/column-groups.test.ts`** — card-limit tests migrated from dead `executeTool` to live path
- No database schema changes. No API contract changes. No frontend changes.
