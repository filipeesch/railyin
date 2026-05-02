## ADDED Requirements

### Requirement: SpyLogger factory available to all test files
`src/bun/test/support/logger-test-utils.ts` SHALL export a `makeSpyLogger()` function returning an object that implements `Logger` and records all invocations in a `calls` array. The factory SHALL also export a `SpyLogger` TypeScript interface extending `Logger` with `calls: Array<{ level: LogLevel; message: string; opts?: LogOptions }>` and a `reset()` method to clear captured calls between test cases.

#### Scenario: Spy captures a log call
- **WHEN** `spy.log("warn", "test message", { context: "x" })` is called
- **THEN** `spy.calls` contains one entry with `{ level: "warn", message: "test message", opts: { context: "x" } }`

#### Scenario: Spy reset clears calls
- **WHEN** `spy.log(...)` is called once, then `spy.reset()` is called
- **THEN** `spy.calls.length` equals `0`

---

### Requirement: Logger interface unit tests
`src/bun/test/logger.test.ts` SHALL verify the `Logger` interface implementations: `noopLogger` and `makeSpyLogger` (unit, no DB) and `realLogger` (integration, requires `initDb`).

#### Scenario: noopLogger never throws on any log level
- **WHEN** `noopLogger.log(level, "msg")` is called for each `LogLevel` value
- **THEN** no exception is thrown

#### Scenario: noopLogger never throws with no options
- **WHEN** `noopLogger.log("info", "msg")` is called without a third argument
- **THEN** no exception is thrown

#### Scenario: noopLogger never throws with full options
- **WHEN** `noopLogger.log("error", "msg", { context: "c", metadata: { x: 1 } })` is called
- **THEN** no exception is thrown

#### Scenario: SpyLogger captures level correctly
- **WHEN** `spy.log("error", "boom")` is called
- **THEN** `spy.calls[0].level` equals `"error"`

#### Scenario: SpyLogger captures message correctly
- **WHEN** `spy.log("debug", "hello")` is called
- **THEN** `spy.calls[0].message` equals `"hello"`

#### Scenario: SpyLogger accumulates multiple calls
- **WHEN** `spy.log("info", "a")` and `spy.log("warn", "b")` are called in sequence
- **THEN** `spy.calls.length` equals `2`

#### Scenario: realLogger inserts row into logs table
- **WHEN** `initDb()` has been called and `realLogger.log("info", "hello", { context: "test" })` is called
- **THEN** a row exists in the `logs` table with `level = "info"` and `message = "hello"`

#### Scenario: realLogger row has correct context column
- **WHEN** `initDb()` has been called and `realLogger.log("debug", "msg", { context: "my-ctx" })` is called
- **THEN** the inserted row has `context = "my-ctx"`

---

### Requirement: AnthropicProvider logs usage on stream completion
`AnthropicProvider.stream()` SHALL invoke the injected logger at `"debug"` level when a `message_stop` event is received from the Anthropic SSE stream.

#### Scenario: Usage log fired on message_stop
- **WHEN** a spy logger is injected and `stream()` is driven to completion with a `message_stop` SSE event
- **THEN** `spy.calls` contains at least one entry with `level: "debug"` and `message` containing `"usage"`

#### Scenario: Usage log includes token count info
- **WHEN** a spy logger is injected and the SSE response carries `usage: { input_tokens: 10, output_tokens: 5 }`
- **THEN** `spy.calls` contains a `"debug"` entry whose `message` contains a numeric token value

#### Scenario: realLogger default writes usage to DB
- **WHEN** `AnthropicProvider` is constructed without an explicit logger (default `realLogger`) and `initDb()` has been called and the stream completes with a `message_stop` event
- **THEN** the `logs` table contains a row with `level = "debug"` and `message` containing `"usage"`

---

### Requirement: retryStream logs on retry conditions
`retryStream` SHALL invoke the injected logger at `"warn"` level when a 429 rate-limit error triggers a retry, when the watchdog fires, and when all retry attempts are exhausted.

#### Scenario: 429 retry logs warn
- **WHEN** a spy logger is passed via `_tc.logger`, the provider throws a 429 error on the first attempt, and `retryStream` retries
- **THEN** `spy.calls` contains at least one `"warn"` entry with `message` containing a retry-related keyword (e.g., `"retry"` or `"429"`)

#### Scenario: Watchdog fire logs warn
- **WHEN** a spy logger is passed via `_tc.logger` and the stream stalls beyond the watchdog timeout
- **THEN** `spy.calls` contains at least one `"warn"` entry with `message` containing `"watchdog"`

#### Scenario: Retry exhaustion logs warn
- **WHEN** a spy logger is passed via `_tc.logger` and all retry attempts fail
- **THEN** `spy.calls` contains at least one `"warn"` entry with `message` containing `"exhausted"` or `"failed"`

---

### Requirement: compactMessages logs orphaned tool_calls
`compactMessages` SHALL invoke the injected logger at `"warn"` level when a `tool_call` message has no matching `tool_result` in the messages array. It SHALL NOT invoke the logger when every `tool_call` has a paired `tool_result`.

#### Scenario: Orphaned tool_call triggers warn log
- **WHEN** a spy logger is injected and the messages array contains a `tool_call` with no matching `tool_result`
- **THEN** `spy.calls` contains at least one `"warn"` entry with `message` containing `"orphan"`

#### Scenario: Paired tool_call does not trigger warn log
- **WHEN** a spy logger is injected and every `tool_call` in the messages array has a corresponding `tool_result`
- **THEN** `spy.calls` contains no `"warn"` entries after `compactMessages` returns

#### Scenario: noopLogger suppresses warn without crash
- **WHEN** `noopLogger` is injected and the messages array contains an orphaned `tool_call`
- **THEN** `compactMessages` returns without throwing, and no log call is recorded
