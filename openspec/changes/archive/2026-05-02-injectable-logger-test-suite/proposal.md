## Why

`di-logger-ai-layer` fixes the Stryker dry-run crash by injecting `noopLogger` into `AnthropicProvider`, `retryStream`, and `compactMessages`. That fixes the CI failure — but leaves the logging behavior itself unverified: tests only prove the modules don't crash when logging is disabled, not that logging is actually invoked on the paths that matter. Now that `Logger` is injectable, we can write a focused test suite that asserts log calls ARE made at the right level and with the right message on key operational paths. We also need to document the `Logger` interface contract itself in a dedicated test file, and provide a shared `makeSpyLogger()` factory so future test authors don't reinvent test doubles for logging.

## What Changes

- **New `src/bun/test/support/logger-test-utils.ts`** — exports `SpyLogger` interface and `makeSpyLogger()` factory; co-located with existing support utilities (`claude-sdk-mock.ts`, `scripted-engine.ts`, etc.)
- **New `src/bun/test/logger.test.ts`** — unit tests for `noopLogger` (never throws, any level/opts) and `makeSpyLogger` (captures calls, reset works); integration tests for `realLogger` (inserts row into `logs` table with correct columns)
- **`src/bun/test/providers.test.ts` extended** — new describe block "AnthropicProvider — logger injection": spy confirms `"debug"` usage log on `message_stop`; spy confirms `"warn"` log on `max_tokens` hit; integration test verifies production default (`realLogger`) still writes to `logs` table
- **`src/bun/test/retry.test.ts` extended** — new describe block "retryStream — logger injection": spy confirms `"warn"` on 429 retry; spy confirms `"warn"` on watchdog fire; spy confirms `"warn"` on retry exhaustion
- **`src/bun/test/review.test.ts` extended** — new describe block "compactMessages — logger injection": spy confirms `"warn"` on orphaned tool_call; spy confirms no log on paired tool_call+tool_result; noopLogger suppresses warn without crash

## Capabilities

### New Capabilities
- `injectable-logger-tests`: Test coverage for the `Logger` interface, `noopLogger`, `realLogger`, and the spy logger factory; plus behavioral verification that logging is invoked on key AI-layer operational paths.

### Modified Capabilities

## Impact

- **`src/bun/test/support/logger-test-utils.ts`** — new file, no production impact
- **`src/bun/test/logger.test.ts`** — new file, no production impact
- **`src/bun/test/providers.test.ts`** — 3 new test cases (1 needs `initDb`)
- **`src/bun/test/retry.test.ts`** — 3 new test cases (no DB needed)
- **`src/bun/test/review.test.ts`** — 3 new test cases (no DB needed for new tests)
- No production code changes, no frontend changes, no DB schema changes
- Depends on `di-logger-ai-layer` being implemented first (`Logger`, `noopLogger`, `realLogger` must exist)
