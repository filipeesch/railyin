## Context

`di-logger-ai-layer` introduces `Logger`, `noopLogger`, and `realLogger` into the codebase and injects `noopLogger` into the existing test files to fix the Stryker dry-run crash. That change verifies the modules don't crash without a DB, but leaves the behavioral logging contracts unverified. This change adds the complementary test suite that uses a spy logger to assert logging IS invoked on specific operational paths.

The key enabler is the spy logger pattern: a `Logger` implementation that records all `log()` calls into a `calls` array, allowing tests to assert `level`, `message`, and `opts` without any DB. Since `makeSpyLogger()` is useful across three test files, it lives in the shared `src/bun/test/support/` directory alongside other test utilities like `claude-sdk-mock.ts`.

## Goals / Non-Goals

**Goals:**
- Verify `noopLogger` never throws for any level/opts combination
- Verify `realLogger` correctly delegates to the `logs` table (integration)
- Verify `AnthropicProvider` actually invokes the logger on `message_stop` and `max_tokens` paths
- Verify `retryStream` invokes the logger on 429 retry, watchdog fire, and retry exhaustion paths
- Verify `compactMessages` invokes the logger when orphaned tool_calls are detected and is silent when tool_calls are paired
- Provide a shared `makeSpyLogger()` factory consumable by all present and future test files

**Non-Goals:**
- Testing `session-memory.ts` logger injection — the log call is inside a private `_doExtract` function requiring a full DB + config + provider mock; the transitive coverage via `orchestrator.test.ts` is sufficient
- Testing the `realLogger` output format (stdout echoing) — this is cosmetic and hard to assert in tests
- Playwright/E2E tests — no UI surface involved

## Decisions

### Decision: `SpyLogger` defined in `logger-test-utils.ts`, not inline
All three test files that need spy assertions (`providers.test.ts`, `retry.test.ts`, `review.test.ts`) import from `support/logger-test-utils.ts`. This avoids three diverging implementations and a single `interface SpyLogger extends Logger` definition serves as documentation.

### Decision: Spy logger does NOT capture `console.log` output
`realLogger` echoes to stdout; `SpyLogger` does not. Tests that need to assert stdout output should use `vi.spyOn(console, "log")` explicitly. The spy only captures `Logger.log()` calls.

### Decision: `AnthropicProvider` production-default test uses `initDb`
The "production default still works" test constructs `AnthropicProvider` without a logger argument, which means `realLogger` is used, which means `getDb()` is called on `message_stop`. This one test must call `initDb()`. It lives in the same `"logger injection"` describe block so the pattern is clear. All 27 existing constructions pass `noopLogger` and remain DB-free.

### Decision: Spy assertions match on `message` substring, not exact string
Log messages in `retry.ts` and `anthropic.ts` contain dynamic values (token counts, attempt numbers, delays). Assertions use `expect.stringContaining(...)` or regex rather than exact equality. This makes tests stable across minor message wording changes.

### Decision: Orphan test builds messages as `as any[]` mocks
`compactMessages` reads `.id`, `.type`, `.role`, `.content`, `.metadata` from `ConversationMessageRow`. The existing `compactMessages` test in `review.test.ts` uses `as any[]` mocks. The new orphan test follows the same pattern — no DB, no seeding, just plain object mocks. The field names match the snake_case interface.

## Risks / Trade-offs

- **[Risk] Spy message strings couple to implementation** → Mitigation: use `stringContaining` with short stable substrings (`"usage"`, `"watchdog"`, `"orphaned"`) rather than full message templates
- **[Trade-off] `logger.test.ts` integration section requires `initDb`** → Accepted: this is exactly the right place to document that `realLogger` needs a DB — it's explicit and instructive
- **[Trade-off] 17 new tests adds ~2s to the test suite** → Negligible; the forks pool in `vitest.backend.config.ts` parallelizes across files
