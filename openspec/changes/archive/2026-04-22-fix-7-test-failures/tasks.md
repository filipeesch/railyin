## 1. Real Bug Fixes (Production Impact)

- [x] 1.1 `src/bun/engine/orchestrator.ts:982` — Restore `toolParentBlockId = event.parentCallId ?? reasoningBlockId ?? null` (was reverted to `event.parentCallId ?? null`). This fixes S-18 stream-tree test and restores correct tool-under-reasoning-bubble nesting in the UI.

- [ ] 1.2 `src/bun/workflow/engine.ts` — In `cancelExecution()`, add `executionControllers.delete(executionId)` immediately after `controller.abort()`. This fixes the Copilot cancel test (stale controller leaks across tests) and the production bug where a cancelled executionId cannot be re-started.

- [ ] 1.3 `src/bun/workflow/tools.ts:1175` — Fix the shell command tokeniser regex: change `/&&|\|\||[|;]/` to `/&&|\|\||[;]/` (remove bare `|` from the character class). This fixes the shell binary filter test (`bun test | cat` should only require approval for `bun`, not `cat`).

## 2. Design Gap Fix

- [ ] 2.1 `src/bun/workflow/tools.ts` — Add the 6 todo tool definitions to `TOOL_DEFINITIONS`. Each needs at minimum `name`, `description`, and `parameters` schema matching what's in `COMMON_TOOL_DEFINITIONS` (`engine/common-tools.ts`). Verify that `resolveToolsForColumn(["todos"])` now returns a non-empty list and that no duplicate-injection occurs when the engine merges common tools + column tools.

## 3. Stale Test Updates

- [ ] 3.1 `src/bun/test/handlers.test.ts:362` — Change `workspace_id` to `workspace_key` in the `INSERT OR IGNORE INTO enabled_models` call (migration renamed the column from integer FK to text key).

- [ ] 3.2 `src/bun/test/claude-events.test.ts:25` — Add `display: { label: "search" }` to the `toEqual` expectation for the `tool_start` event (added by commit `a3669f4` — structured ToolCallDisplay).

- [ ] 3.3 `src/bun/test/lsp.test.ts` — In the "returns different managers for different taskIds" test, pass a non-empty `serverConfigs` array to both `registry.getManager(3, ...)` and `registry.getManager(4, ...)` calls. Use `[{ id: "ts", command: "typescript-language-server", args: ["--stdio"] }]`. Verify `LSPServerManager` is lazy (doesn't start the server on construction) to ensure the test doesn't require the binary to exist.

## 4. Verify & Run

- [ ] 4.1 Run the full backend test suite: `bun test src/bun/test --timeout 20000`. All 7 previously failing tests must pass with no new failures. Target: 597 pass, 0 fail.
