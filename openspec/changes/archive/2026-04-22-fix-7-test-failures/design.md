## Context

The backend test suite (`bun test src/bun/test --timeout 20000`) has 7 failing tests across 6 files. The failures fall into three categories:

1. **Regressions** — Working code was broken by a merge or a missing cleanup call
2. **Stale tests** — App code evolved (schema rename, new field added, API guard added) but tests were not updated
3. **Design gap** — `todos` group in `TOOL_GROUPS` expands to tool names that are not in `TOOL_DEFINITIONS`, so `resolveToolsForColumn(["todos"])` silently returns `[]`

No new architecture, migrations, or external dependencies are involved. Every fix is a targeted change to a specific line or block.

## Goals / Non-Goals

**Goals:**
- All 7 failing tests pass
- No regressions in the 590 currently passing tests
- The `executionControllers` cleanup fix also closes a production bug (stale controller prevents re-execution after cancel)
- The shell binary regex fix aligns implementation with the spec intent (pipe receivers are not "the command being run")
- Todo tools become configurable via column `tools:` config in `railyin.yaml`

**Non-Goals:**
- No test-infrastructure refactoring (only targeted test updates where the test was simply wrong)
- No UI changes
- No migrations
- No changes to `COMMON_TOOL_DEFINITIONS` — todo tools remain auto-injected; this change makes them *also* available via `TOOL_DEFINITIONS`

## Decisions

### D1 — Fix the orchestrator toolParentBlockId regression in-place

Commit `d0ad652` added `toolParentBlockId = event.parentCallId ?? reasoningBlockId ?? null` but the current `orchestrator.ts` has reverted to `event.parentCallId ?? null`. Restore the original line.

**Why not fix in the test?** The test (`S-18`) accurately captures the intended UX: a tool call that follows a reasoning bubble should be visually nested under it. The code regression is the problem.

### D2 — Delete executionController entry on cancel/abort

`cancelExecution()` calls `controller.abort()` and returns, but never removes the entry from the `executionControllers` Map. In tests, all test runs use incrementing IDs starting at 1 per fresh DB — the stale entry for id=1 causes the copilot cancel test to hit the wrong code path. In production, a cancelled execution cannot be re-queued because the Map still holds its (already-aborted) controller.

**Fix**: Add `executionControllers.delete(executionId)` immediately after `controller.abort()`.

**Why not reset in initDb?** The Map is module-level in `engine.ts`, not tied to the DB. The correct fix is to delete on cancel — that's the intended lifecycle.

### D3 — Remove bare `|` from shell tokeniser regex

Current regex: `/&&|\|\||[|;]/` — the `[|;]` character class matches bare `|`, causing `cmd | receiver` to split and flag `receiver` as a binary needing approval. The spec says pipe receivers should not be flagged.

**Fix**: Change to `/&&|\|\||[;]/` (remove `|` from the character class, keep `;` and `||`).

**Alternative considered**: Split on `|` but filter out the receiver token. Rejected — more complex, and the spec intent is clear: only the initiating command needs approval.

### D4 — Add todo tool stubs to TOOL_DEFINITIONS

Todo tools (`create_todo`, `edit_todo`, etc.) are defined in `COMMON_TOOL_DEFINITIONS` (`engine/common-tools.ts`) and auto-injected by the engine. `TOOL_DEFINITIONS` in `tools.ts` is the registry for column-configurable tools. Currently `TOOL_GROUPS` declares a `todos` group that names tools not in `TOOL_DEFINITIONS`, so `resolveToolsForColumn(["todos"])` emits warnings and returns nothing.

**Fix**: Add the 6 todo tool definitions to `TOOL_DEFINITIONS` in `tools.ts`. These can be simplified stubs (name + description) — the full schema lives in `common-tools.ts` and is used by the engine directly.

**Why not remove todos from TOOL_GROUPS?** Column-configurable todos is a valid use case. The TOOL_GROUPS entry is correct; the gap is that TOOL_DEFINITIONS doesn't mirror it.

### D5 — Update three stale tests

| Test | What changed in app | Test fix |
|------|-------------------|----------|
| `handlers.test.ts` — `models.listEnabled` | Migration renamed `workspace_id → workspace_key` in `enabled_models` | Change `workspace_id` to `workspace_key` in INSERT |
| `claude-events.test.ts` — `tool_start` | `a3669f4` added `display: { label }` to `tool_start` events | Add `display: { label: "search" }` to `toEqual` expectation |
| `lsp.test.ts` — TaskLSPRegistry | `getManager` guards on `serverConfigs.length === 0` returning `null` | Pass `[{ id: "ts", command: "typescript-language-server", args: ["--stdio"] }]` as serverConfigs |

## Risks / Trade-offs

- **[Risk] Adding todo tools to TOOL_DEFINITIONS may cause duplicate injection** → The engine always injects `COMMON_TOOL_DEFINITIONS` first, then column tools. If both lists contain `create_todo`, the model could see duplicate tool definitions. Mitigation: `resolveToolsForColumn` already deduplicates by name; the engine must also deduplicate when merging common tools + column tools. Verify dedup logic before applying.

- **[Risk] LSP test fix requires a real-ish serverConfigs entry** → `LSPServerManager` constructor may throw if given a config with a non-existent command. The test calls `releaseTask` which shuts it down — but startup might fail. Mitigation: Use a config that doesn't auto-start (lazy init in `TaskLSPRegistry` means the server is not started until the manager is actually used). Verify `LSPServerManager` is lazy before applying.

- **[Risk] Shell regex change could miss legitimate `|` uses** → Legitimate pipeline commands like `cat file | wc -l` will no longer flag `wc` for approval. This is the intended behavior per the spec. No security regression since the security boundary is the initiating command.
