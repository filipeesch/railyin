## Why

The `pi-engine-parallelism` change introduces a provider-limiter, `delegate` tool, and background compaction — none of which have test coverage today. This companion change defines and tracks the full test suite so implementation and test work can proceed independently and be reviewed separately.

## What Changes

- New unit test file `src/bun/test/pi-provider-limiter.test.ts` — pure unit tests for the `ProviderLimiter` class (FIFO semaphore, abort, timeout, tryAcquire, LM Studio startup warning, metrics snapshot).
- New integration test file `src/bun/test/pi-delegate.test.ts` — integration tests for the `delegate` tool using `MockAgentSession` (validation, concurrency cap, error isolation, parentCallId tagging on child events, temp file cleanup, parent abort propagation).
- Additions to `src/bun/test/pi-engine.test.ts` — background compaction trigger/skip/no-double, summary persistence, shutdown cancellation.
- Additions to `src/bun/test/pi-engine.test.ts` — config validation (invalid `max_per_call`, `early_margin_tokens`, soft-threshold math).
- New Playwright spec `e2e/ui/delegate-rendering.spec.ts` — UI rendering of `delegate` tool call with nested children (badge count, expand/collapse, digest markdown in message body) using static pre-seeded messages, reusing the S-26 `parentCallId` fixture pattern.
- No production code changes — only test files. Where production code needs a small refactoring to be testable (extract pure function, inject factory), that refactoring is specified in the `pi-engine-parallelism` implementation tasks and is a prerequisite here.

## Capabilities

### New Capabilities
- `pi-engine-parallelism-tests`: test specifications covering the limiter, delegate tool, background compaction, config validation, and UI rendering introduced by `pi-engine-parallelism`.

### Modified Capabilities
- None.

## Impact

- **Code**: New and extended test files only. Zero production code changes.
- **Dependencies**: Requires `pi-engine-parallelism` implementation tasks (DI seams, extracted pure functions) to be completed before integration tests can compile.
- **APIs**: None.
- **Playwright**: New `e2e/ui/delegate-rendering.spec.ts` — uses static `conversations.getMessages` mock (same pattern as `tool-rendering.spec.ts`), no live WS required.
