## Context

The backend test suite (`bun test src/bun/test --timeout 20000`) has 32 failures across three files. Investigation confirmed three independent root causes, all regressions introduced on `main`:

1. **Migration fixture staleness** (2 tests in `db-migrations.test.ts`): Test fixtures were authored when `028_chat_session_mcp_tools` was the latest migration. Migrations `030_stream_events_cleanup` and `031_conversation_pagination_index` were added later and both fail against the frozen fixture schemas.

2. **Return type mismatch** (8 tests in `tasks-tools.test.ts`): The `executeCommonTool` function was refactored to return `ToolExecutionResult = { type: "result", text } | { type: "suspend", payload }` to support the `interview_me` suspend path. Eight todo-tool tests still treat the return value as a plain string and call `JSON.parse(result)` directly, producing `JSON.parse("[object Object]")` → SyntaxError.

3. **Dead token callback channel** (22 tests in `copilot-rpc-scenarios.test.ts` + `claude-rpc-scenarios.test.ts`): The streaming pipeline refactor (commit `752fcbe`) moved event delivery from `onToken` callbacks to `onStreamEvent`. The `Orchestrator.onToken` is hardcoded as `() => {}` and never settable from outside. `shared-rpc-scenarios.ts` still waits on `waitForTokenDone()` which polls `recorder.tokenEvents` — a list that is never populated — causing all 22 tests to hit the 5 s internal timeout.

All production code is correct. Only test code needs updating.

## Goals / Non-Goals

**Goals:**
- All tests in `bun test src/bun/test --timeout 20000` pass
- Each fix is surgical — touch only the broken assertion/fixture, nothing else
- No production code changes

**Non-Goals:**
- Expanding test coverage beyond what's needed to fix existing tests
- Refactoring the migration test approach (fixtures vs. full migration runs)
- Changing the `ToolExecutionResult` API (already correct)
- Changing the `onToken`/`onStreamEvent` orchestrator architecture

## Decisions

### 1. Fix migration fixtures in-place rather than restructuring tests

The two migration tests use a "frozen fixture" pattern: they manually create a partial DB state (as if earlier migrations had already run) and then call `runMigrations()` to test idempotency or repair logic. This is intentional and valuable.

**Decision**: Keep the fixture pattern. Simply update the fixture schemas to include the columns/tables that migrations `029`/`030` would have produced, so that `030` and `031` don't fail with missing schema errors.

**Alternative considered**: Run `runMigrations()` twice (first on empty, then on partial) to avoid fixtures entirely. Rejected — it changes test intent and loses the targeted upgrade-path coverage.

**Specific changes**:
- Test 1 fixture: The `stream_events` table must include `conversation_id INTEGER NULL` (what migration `029` adds). This prevents `030`'s `SELECT conversation_id` from failing.
- Test 4 fixture: Must include a `conversation_messages` table (even if empty) so that migration `031`'s `CREATE INDEX ON conversation_messages(...)` has a target table. Alternatively, add a `hasTable("conversation_messages")` guard to migration `031`. **Decision: add the guard to the migration** — it's the safer fix and prevents this class of failure for all future test environments.

### 2. Unwrap `ToolExecutionResult` at the call site in tests

**Decision**: Update the 8 test assertions to use `(await executeCommonTool(...)).text` before calling `JSON.parse`. This is the minimal, correct fix.

**Alternative considered**: Add a helper `parseToolResult(r)` that unwraps `.text`. Rejected — over-engineering for 8 simple call sites.

### 3. Replace `waitForTokenDone` with `waitForStreamDone` in shared scenarios

**Decision**: In `shared-rpc-scenarios.ts`, replace every `recorder.waitForTokenDone(executionId)` call with `recorder.waitForStreamDone(executionId)`. The stream-done event (`type: "done"`) is emitted at the end of every execution and is already wired through `onStreamEvent` → `recordStreamEvent`.

**Alternative considered**: Wire `onToken` into the backend-rpc-runtime. Rejected — `onToken` is a legacy channel; the streaming pipeline is the canonical channel and `waitForStreamDone` is already used by some passing tests.

## Risks / Trade-offs

- **[Risk] Migration `031` guard changes production behavior slightly** → Mitigation: The guard `hasTable("conversation_messages")` is safe — `031` only adds an index, and if `conversation_messages` doesn't exist the index is meaningless. The guard matches the pattern used by all other conditional migrations in the file.
- **[Risk] `waitForStreamDone` may have subtly different timing than `waitForTokenDone`** → Mitigation: The `done` stream event is emitted as the final action of every execution path in the orchestrator, making it the most reliable completion signal available.
