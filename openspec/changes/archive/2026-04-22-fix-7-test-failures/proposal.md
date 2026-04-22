## Why

7 backend tests are failing in `bun test src/bun/test --timeout 20000`, blocking CI and masking future regressions. The failures span 3 real app bugs (one regression introduced by a merge, two pre-existing bugs), 3 stale tests that were never updated after API/schema changes, and 1 test that exposes a design gap in the column-tool-config system.

## What Changes

- **Fix real regression**: restore `?? reasoningBlockId` in `orchestrator.ts` tool_call parentBlockId logic (reverted by a merge, causing stream-tree hierarchy to break)
- **Fix real bug**: add `executionControllers.delete(executionId)` after abort in `engine.ts` to prevent stale controller state leaking across tests (and in production, preventing re-execution of same executionId)
- **Fix real bug**: remove bare `|` from the shell command tokeniser regex in `tools.ts` so pipe receivers are not flagged as unapproved binaries
- **Fix stale test**: update `handlers.test.ts` to use `workspace_key` instead of removed `workspace_id` column in `enabled_models`
- **Fix stale test**: update `claude-events.test.ts` to include the `display` field added by commit `a3669f4` (structured ToolCallDisplay)
- **Fix stale test**: update `lsp.test.ts` TaskLSPRegistry test to pass non-empty `serverConfigs` so `getManager` doesn't short-circuit to `null`
- **Fix design gap**: add todo tool definitions to `TOOL_DEFINITIONS` in `tools.ts` so the `todos` group resolves correctly via `resolveToolsForColumn` (currently todo tools only live in `COMMON_TOOL_DEFINITIONS` and are auto-injected, making them unconfigurable via column config)

## Capabilities

### New Capabilities
<!-- None — this is a pure bug fix / test correctness change -->

### Modified Capabilities
- `shell-command-approval`: requirement change — pipe receivers (`cmd | receiver`) should not require separate approval; only the initiating command matters
- `column-tool-config`: requirement change — the `todos` group name must resolve to tool definitions via `resolveToolsForColumn` (currently it silently expands to nothing)
- `engine-session-lifecycle`: requirement change — cancelling an execution must clean up its controller entry so the same executionId can be re-used and stale state does not affect subsequent operations

## Impact

- `src/bun/engine/orchestrator.ts` — 1-line restore
- `src/bun/workflow/engine.ts` — 1-line add
- `src/bun/workflow/tools.ts` — regex fix + todo tool definitions added to `TOOL_DEFINITIONS`
- `src/bun/test/handlers.test.ts` — 1-word column name fix
- `src/bun/test/claude-events.test.ts` — add `display` field to expected event
- `src/bun/test/lsp.test.ts` — pass real serverConfigs to TaskLSPRegistry test
- No API changes, no migration needed, no UI changes
