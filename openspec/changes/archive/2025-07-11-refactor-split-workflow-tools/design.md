## Context

`src/bun/workflow/tools.ts` (2039 lines) bundles five unrelated concerns: Myers diff algorithm, tool JSON schemas, a tool registry/resolver, a monolithic `executeTool` dispatcher (~800 lines of switch-case), and an LSP dispatcher. A parallel live system exists in `engine/common-tools.ts`, which duplicates all 8 board tool implementations and is the only path actually called in production. The `executeTool` function in `tools.ts` is exercised only by tests, never by any engine.

An audit of the two implementations revealed silent production bugs: `move_task` in `common-tools.ts` omits card-limit enforcement and position ordering; `create_task` skips engine-level model resolution; `delete_task` missing LSP registry cleanup. Additionally, shell binary extraction exists in two places with different pipe-handling semantics — neither is reachable from the Copilot engine.

## Goals / Non-Goals

**Goals:**
- Split `tools.ts` into focused sub-modules with single responsibilities
- Eliminate duplication: `board-tools.ts` becomes the single source of truth for all 8 board operations
- Fix silent production bugs uncovered during the deduplication audit
- Make shell binary extraction engine-agnostic so Copilot and future engines can share it
- Maintain full backward compatibility — `tools.ts` becomes a re-export barrel
- Keep all existing tests green; migrate board tests from dead `executeTool` path to the live path

**Non-Goals:**
- Adding new tool capabilities
- Changing `TOOL_DEFINITIONS` / tool schemas
- Frontend changes of any kind
- Database schema changes
- Performance optimization

## Decisions

### D1 — `board-tools.ts` is the single source of truth; `common-tools.ts` delegates

**Decision**: Extract all 8 board tool handlers into `src/bun/workflow/tools/board-tools.ts` as standalone async functions (`execGetTask`, `execMoveTask`, etc.). `engine/common-tools.ts` replaces its inline switch cases with calls to these functions. `executor.ts` (the thin `executeTool` wrapper for tests) also delegates to the same functions.

**Rationale**: The live production path is `executeCommonTool`. Keeping the single source in `workflow/tools/` preserves the module boundary (tools are a workflow concern, not an engine concern) while ensuring the tested path and the live path are identical.

**Alternative considered**: Keep board tools in `common-tools.ts` and have `executor.ts` import from there. Rejected because it inverts the dependency direction — engine code should not be the source of truth for workflow tools.

### D2 — Unified `BoardToolContext` interface wraps callback shape differences

**Decision**: `board-tools.ts` defines a minimal `BoardToolContext`:
```typescript
export interface BoardToolContext {
  taskId?: number;
  boardId?: number;
  onTransition: (taskId: number, toState: string) => void;
  onHumanTurn:  (taskId: number, message: string)  => void;
  onCancel:     (executionId: number)               => void;
}
```
`CommonToolContext` (engine/types.ts) already matches this shape exactly. The legacy `ToolContext` (from tests) has callbacks under a `taskCallbacks` namespace; `executor.ts` provides a thin adapter.

**Rationale**: Avoids changing `CommonToolContext` (would require touching all engine adapters) while giving board-tools a clean, engine-agnostic contract.

### D3 — `move_task` production fix: use `tools.ts` semantics

**Decision**: `board-tools.ts` implements the correct `move_task` behavior from the tested-but-dead `tools.ts` path: validate that the target column exists in the workflow template, enforce the column's card limit (reject if at capacity), compute a new position value (MIN/2, or 500 if empty), and write both `workflow_state` and `position` to the DB.

**Rationale**: The `common-tools.ts` version silently skips both card-limit enforcement and position ordering — these are spec-defined behaviors (`column-card-limit` spec). The test suite was already asserting the correct behavior; production was the outlier.

### D4 — `create_task` production fix: engine model resolution

**Decision**: `board-tools.ts` resolves the effective model as `args.model → config.engine.model → config.workspace.default_model`. `common-tools.ts` only checked `args.model → workspace.default_model`, silently ignoring engine-level model config.

**Rationale**: Minor bug with user-visible impact when an engine specifies a default model that differs from the workspace default.

### D5 — `delete_task` merged behavior

**Decision**: `board-tools.ts` combines the best of both implementations: cancel the active execution if present (from `tools.ts`), cascade-delete all DB rows, and release the LSP registry entry (from `common-tools.ts`, was missing in `tools.ts`).

**Rationale**: Neither implementation was complete on its own; the merge is straightforward.

### D6 — Shell binary extraction moves to `engine/approved-commands.ts` as `parseShellBinaries`

**Decision**: A new exported function `parseShellBinaries(command: string): string[]` is added to `engine/approved-commands.ts`. It uses the **inclusive** semantics from `extractCommandBinaries` in `tools.ts`: pipe characters (`|`) are treated as command boundaries, so `ls | grep foo` extracts `["ls", "grep"]`. `getUnapprovedShellBinaries` in `claude/adapter.ts` is updated to call `parseShellBinaries` and the dead `extractCommandBinaries` import is removed.

**Rationale**: Engine-agnostic placement ensures Copilot and future engines can share the same function. Inclusive pipe semantics are more conservative (require more approval) and therefore safer.

**Alternative considered**: Keep exclusive semantics (current production behavior). Rejected per explicit architectural decision: the more restrictive behavior is correct for a security gate.

**Behavior change**: Commands like `bun test | cat` will now prompt approval for `cat`. The `shell-command-approval` spec delta captures this change.

### D7 — `executeLspTool` moves to `workflow/tools/lsp-tools.ts`

**Decision**: Move `executeLspTool` and its private `safePath` helper to `src/bun/workflow/tools/lsp-tools.ts`. `engine/common-tools.ts` updates its import.

**Rationale**: LSP tool execution is a workflow concern, not an engine concern. The function has no engine-specific dependencies.

### D8 — `executeTool`, dead fs/shell/search implementations, and related helpers are deleted

**Decision**: `executeTool`, `myersDiff`, `applyOneReplacement`, `isPrivateIp`, `safePath` (when not used by LSP tools), `WriteResult`, `ShellApprovalDecision`, `ToolContext`, and `TaskToolCallbacks` are removed entirely. The tool implementations for `read_file`, `write_file`, `edit_file`, `multi_replace`, `run_command`, `search_text`, `find_files`, `fetch_url`, and `search_internet` are deleted along with their `TOOL_DEFINITIONS` entries. `workflow/tools.ts` becomes a barrel re-exporting only live symbols.

**Rationale**: These were part of a native engine that was removed. Preserving dead code in sub-modules would give the false impression it is in use, make the new files artificially large, and require maintaining tests for unreachable code paths. Clean deletion is the right call.

**Note on `safePath`**: The function appears in both the fs-tool and LSP contexts. Only the LSP usage survives — it moves to `lsp-tools.ts` as a private helper.

### D9 — Test suite: dead tests deleted; board/card-limit tests migrated to live path

**Decision**: Tests in `tools.test.ts` that exercise the dead `executeTool` fs/shell/search cases — including `myersDiff`, `applyOneReplacement`, and `extractCommandBinaries` — are deleted. Board tool tests in `tasks-tools.test.ts` and card-limit tests in `column-groups.test.ts` that currently call `executeTool` are migrated to `executeCommonTool` or direct `board-tools.ts` function calls. Registry and TOOL_GROUPS tests in `tools.test.ts` are kept (they test live exports via the barrel).

**Rationale**: Tests should exercise the live production code path. Deleting tests for removed code is correct hygiene. Migrating board tests ensures the production path is covered by the existing test logic rather than duplicating it.

## Risks / Trade-offs

- **`move_task` behavior change in production** → Card-limit enforcement and position ordering are now enforced where they weren't before. Any agent call that previously moved a task to a full column will now get an error. This is the correct behavior (it was always intended), but it's a runtime behavior change. Mitigation: the test suite has been asserting this for a long time; the UI move path already enforces limits separately.
- **Pipe receiver approval is now required** → Agents that previously piped output to `cat`, `grep`, `wc`, etc. without approval will now see approval prompts. Mitigation: agents can auto-approve these at task setup; the spec delta documents the new expectation.
- **Dead test deletion is irreversible** → Deleting ~400 lines of tests for removed code cannot be undone. Mitigation: the code they tested no longer exists, so the risk is limited to potential future re-introduction.

## Migration Plan

1. Create `workflow/tools/` directory with all live sub-modules
2. Update `engine/common-tools.ts` board cases to import from `board-tools.ts`
3. Update `engine/approved-commands.ts` with `parseShellBinaries`
4. Update `claude/adapter.ts` to remove dead import and call `parseShellBinaries`
5. Replace `workflow/tools.ts` with barrel re-export (live symbols only)
6. Delete dead tests from `tools.test.ts`; migrate board/card-limit tests in `tasks-tools.test.ts` and `column-groups.test.ts` to live path
7. Update `claude-adapter.test.ts` pipe receiver expectation
8. Run full test suite: `bun test src/bun/test --timeout 20000`

Rollback: all changes are in TypeScript. If any test fails the PR does not merge. The barrel re-export ensures no import-level regressions.

## Open Questions

_None — all decisions have been made during exploration._
