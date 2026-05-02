# Spec: DI Logger

## Purpose

Defines the injectable logger interface and the dependency-injection pattern for suppressing database log writes in tests, enabling Stryker dry-runs and unit tests to run without a pre-existing database.

## Requirements

### Requirement: Logger interface exported from logger.ts
`logger.ts` SHALL export a `Logger` interface, a `noopLogger` constant, and a `realLogger` constant.

#### Scenario: Logger interface is importable
- **WHEN** a module imports `Logger`, `noopLogger`, or `realLogger` from `../logger.ts`
- **THEN** TypeScript resolves the types without error

#### Scenario: noopLogger never writes to DB
- **WHEN** `noopLogger.log("debug", "any message", {})` is called
- **THEN** no database write occurs and no error is thrown

#### Scenario: realLogger writes to the logs table
- **WHEN** `realLogger.log("info", "test message", {})` is called with a DB that has the logs table
- **THEN** a row is inserted into the `logs` table

### Requirement: AnthropicProvider accepts an optional Logger
`AnthropicProvider` SHALL accept an optional `logger?: Logger` as its last constructor parameter.

#### Scenario: Default production behavior unchanged
- **WHEN** `new AnthropicProvider(apiKey, model)` is called without a logger argument
- **THEN** the provider uses `realLogger` and all log calls write to the DB as before

#### Scenario: noopLogger suppresses DB writes in tests
- **WHEN** `new AnthropicProvider(apiKey, model, baseUrl, …, noopLogger)` is used in a test without DB setup
- **THEN** stream events are yielded correctly and no database error is thrown

#### Scenario: logUsage called on every message_stop
- **WHEN** `AnthropicProvider.stream()` receives a `message_stop` SSE event
- **THEN** the injected logger's `log` method is called with level `"debug"` and usage data

### Requirement: retryStream and retryTurn support an injectable logger via _tc
The internal `_RetryTimingConfig` type in `retry.ts` SHALL include an optional `logger?: Logger` field. `retryStream` and `retryTurn` SHALL use `_tc.logger ?? realLogger` for all internal log calls.

#### Scenario: Default production behavior unchanged
- **WHEN** `retryStream(provider, messages, {}, 3, 10, {})` is called
- **THEN** all retry/stall/rate-limit log messages are written to the DB as before

#### Scenario: noopLogger suppresses DB writes in tests
- **WHEN** `retryStream(provider, messages, {}, 3, 10, { baseBackoffMs: 0, logger: noopLogger })` is called
- **THEN** retry logic executes normally and no database error is thrown even if the logs table is absent

### Requirement: compactMessages accepts an optional Logger instead of quiet flag
`compactMessages` in `context.ts` SHALL replace `opts.quiet` with `opts.logger?: Logger`. When `opts.logger` is absent, `realLogger` is used.

#### Scenario: Orphaned tool_call logged via injected logger
- **WHEN** `compactMessages(messages, {})` encounters orphaned tool_call messages
- **THEN** `realLogger.log("warn", …)` is called with the orphaned IDs

#### Scenario: noopLogger suppresses orphan warning
- **WHEN** `compactMessages(messages, { logger: noopLogger })` encounters orphaned tool_call messages
- **THEN** no log call reaches the database

### Requirement: extractAndWriteSessionMemory accepts an optional Logger
`extractAndWriteSessionMemory` in `session-memory.ts` SHALL accept an optional `logger?: Logger` parameter. When absent, `realLogger` is used.

#### Scenario: Default production behavior unchanged
- **WHEN** `extractAndWriteSessionMemory(taskId, db)` is called in production
- **THEN** debug/error log messages are written to the DB as before

#### Scenario: noopLogger suppresses DB writes in tests
- **WHEN** `extractAndWriteSessionMemory(taskId, db, noopLogger)` is called in a test without DB setup
- **THEN** the function runs and no database error is thrown
