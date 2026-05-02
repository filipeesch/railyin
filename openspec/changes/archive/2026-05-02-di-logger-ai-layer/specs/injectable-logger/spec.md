## Purpose

Defines requirements for the injectable `Logger` interface introduced in `logger.ts`. Allows AI-layer modules to receive their logging dependency rather than importing the global `log()` function directly, enabling unit tests to run without a database.

## Requirements

### Requirement: Logger interface exported from logger.ts
`logger.ts` SHALL export a `Logger` interface with a single method `log(level: LogLevel, message: string, opts?: LogOptions): void`. It SHALL also export `noopLogger` (an implementation whose `log()` is a no-op) and `realLogger` (an implementation that delegates to the existing `log()` function).

#### Scenario: noopLogger silently discards log calls
- **WHEN** a caller invokes `noopLogger.log("warn", "something")` with no database initialized
- **THEN** no exception is thrown and no database write is attempted

#### Scenario: realLogger delegates to the existing log() function
- **WHEN** a caller invokes `realLogger.log("info", "message", { taskId: 1 })`
- **THEN** the call is equivalent to `log("info", "message", { taskId: 1 })` — a row is inserted into the `logs` table and the message is echoed to stdout

### Requirement: AnthropicProvider accepts an optional Logger
`AnthropicProvider` SHALL accept an optional `logger?: Logger` as its last constructor parameter. When omitted, it SHALL default to `realLogger`. All internal calls to `log()` within the class SHALL be replaced with `this.logger.log()`.

#### Scenario: AnthropicProvider logs usage without database when noopLogger provided
- **WHEN** a test constructs `new AnthropicProvider("key", "model", baseUrl, ..., noopLogger)` and calls `stream()`
- **THEN** `message_stop` processing completes without any database write and no exception is thrown

#### Scenario: AnthropicProvider production behavior unchanged
- **WHEN** `instantiateProvider()` in `ai/index.ts` constructs `AnthropicProvider` without a logger argument
- **THEN** all log calls write to the `logs` table exactly as before

### Requirement: retryStream and retryTurn accept a logger via _RetryTimingConfig
`_RetryTimingConfig` in `retry.ts` SHALL include an optional `logger?: Logger` field. When present, `retryStream` and `retryTurn` SHALL use it for all internal log calls. When absent, they SHALL default to `realLogger`.

#### Scenario: retryStream logs warnings without database when noopLogger in _tc
- **WHEN** `retryStream(provider, messages, {}, 3, 10, { baseBackoffMs: 0, logger: noopLogger })` is called and a 429 retry occurs
- **THEN** the warning log call is routed to `noopLogger` — no DB write, no exception

#### Scenario: retryStream production behavior unchanged
- **WHEN** `retryStream` is called with `_tc = {}` (no logger field)
- **THEN** all log calls write to the `logs` table as before

### Requirement: compactMessages accepts a logger option replacing the quiet flag
`compactMessages` in `context.ts` SHALL accept `opts?: { logger?: Logger }`. The `quiet?: boolean` option SHALL be removed. When `logger` is omitted, the function SHALL default to `realLogger`. Internal callers that previously passed `{ quiet: true }` SHALL pass `{ logger: noopLogger }`.

#### Scenario: compactMessages orphan warning uses injected logger
- **WHEN** `compactMessages(messages, { logger: noopLogger })` is called with orphaned tool_calls
- **THEN** the warning is routed to `noopLogger` — no DB write, no exception

#### Scenario: compactMessages default behavior unchanged for external callers
- **WHEN** `compactMessages(messages)` is called with no opts
- **THEN** orphaned tool_call warnings are written to the `logs` table as before
