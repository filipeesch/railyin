## 1. Shared Test Utility

- [x] 1.1 Create `src/bun/test/support/logger-test-utils.ts` — export `SpyLogger` interface (extends `Logger` with `calls` array and `reset()`) and `makeSpyLogger()` factory that returns a spy implementing `Logger`

## 2. Logger Interface Tests

- [x] 2.1 Create `src/bun/test/logger.test.ts` — unit tests for `noopLogger` (never throws, any level, any opts) and `makeSpyLogger` (captures level, message, opts; reset clears calls; multiple calls accumulate)
- [x] 2.2 Add integration tests to `logger.test.ts` for `realLogger` — call `initDb()`, invoke `realLogger.log(...)`, query the `logs` table and assert `level`, `message`, `context` columns

## 3. AnthropicProvider Logger Spy Tests

- [x] 3.1 Add describe block `"AnthropicProvider — logger injection"` to `providers.test.ts` — inject spy and drive stream to `message_stop`; assert `spy.calls` has a `"debug"` entry with `message` containing `"usage"`
- [x] 3.2 Add scenario to the spy describe block for `max_tokens` hit — inject spy and drive stream to `stop_reason: "max_tokens"`; assert `spy.calls` has a `"warn"` entry
- [x] 3.3 Add production-default integration test — construct `AnthropicProvider` without logger arg, call `initDb()`, drive to `message_stop`, assert `logs` table has a row with `level = "debug"` and message containing `"usage"`

## 4. retryStream Logger Spy Tests

- [x] 4.1 Add describe block `"retryStream — logger injection"` to `retry.test.ts` — inject spy via `_tc.logger`; drive a 429 path; assert `spy.calls` has a `"warn"` entry with `message` containing retry keyword
- [x] 4.2 Add watchdog scenario to the spy describe block — inject spy; drive stream past watchdog timeout; assert `spy.calls` has a `"warn"` entry with `message` containing `"watchdog"`
- [x] 4.3 Add retry exhaustion scenario — inject spy; exhaust all retries; assert `spy.calls` has a `"warn"` entry with message containing exhaustion keyword

## 5. compactMessages Logger Spy Tests

- [x] 5.1 Add describe block `"compactMessages — logger injection"` to `review.test.ts` — inject spy; pass messages with orphaned `tool_call`; assert `spy.calls` has a `"warn"` entry with `message` containing `"orphan"`
- [x] 5.2 Add paired tool_call scenario — inject spy; pass messages where every `tool_call` has a matching `tool_result`; assert no `"warn"` entries in `spy.calls`
- [x] 5.3 Add noopLogger no-crash scenario — inject `noopLogger`; pass messages with orphaned `tool_call`; assert `compactMessages` returns without throwing

## 6. Verification

- [x] 6.1 Run `bun test src/bun/test --timeout 20000` and confirm all 17 new tests pass with zero failures
- [x] 6.2 Run `npx stryker run stryker.backend.json --mutate "src/bun/ai/anthropic.ts"` dry-run and confirm no initial test failures
