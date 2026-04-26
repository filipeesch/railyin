## 1. Fix migration fixtures (db-migrations.test.ts)

- [x] 1.1 In Test 1 fixture (around line 26), add `conversation_id INTEGER NULL` column to the `stream_events` CREATE TABLE statement so migration `030`'s SELECT does not fail
- [x] 1.2 Add a `hasTable("conversation_messages")` guard to migration `031` in `src/bun/db/migrations.ts` so the CREATE INDEX is skipped when the table doesn't exist (prevents future fixture staleness for this migration)
- [x] 1.3 In Test 4 fixture (around line 146), add a minimal `conversation_messages` CREATE TABLE statement (id, conversation_id, ...) to satisfy the index migration, OR verify the guard from 1.2 makes this unnecessary
- [x] 1.4 Run `bun test src/bun/test/db-migrations.test.ts --timeout 20000` and confirm all 4 tests pass

## 2. Fix ToolExecutionResult unwrapping (tasks-tools.test.ts)

- [x] 2.1 Find all 8 failing todo-tool tests in `src/bun/test/tasks-tools.test.ts` (search for `JSON.parse(result)` or `JSON.parse(await executeCommonTool`)
- [x] 2.2 Update each assertion to unwrap `.text` first: change `JSON.parse(result)` → `JSON.parse(result.text)` (or equivalent for the test's variable name)
- [x] 2.3 Run `bun test src/bun/test/tasks-tools.test.ts --timeout 20000` and confirm all 8 previously failing tests now pass

## 3. Fix waitForTokenDone → waitForStreamDone (shared-rpc-scenarios.ts)

- [x] 3.1 In `src/bun/test/support/shared-rpc-scenarios.ts`, replace all calls to `recorder.waitForTokenDone(executionId)` with `recorder.waitForStreamDone(executionId)` (approximately 6 call sites)
- [x] 3.2 Run `bun test src/bun/test/copilot-rpc-scenarios.test.ts --timeout 20000` and confirm all previously timing-out tests now pass
- [x] 3.3 Run `bun test src/bun/test/claude-rpc-scenarios.test.ts --timeout 20000` (if it exists) and confirm no regressions

## 4. Verify full suite

- [x] 4.1 Run `bun test src/bun/test --timeout 20000` and confirm 0 failures across the full suite
