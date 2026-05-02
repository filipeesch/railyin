## Why

The Stryker backend mutation test suite fails in CI with `no such table: logs` because `AnthropicProvider.stream()` calls `log()` on every stream completion, and `log()` silently depends on a fully-migrated SQLite DB. Test files that test pure HTTP streaming behavior (`providers.test.ts`) have no DB setup, and CI has no pre-existing database file. This also affects `retry.ts` (14+ log call sites) and `conversation/context.ts` and `workflow/session-memory.ts`. Injecting a `Logger` interface removes the hidden transitive DB dependency and makes these modules fully unit-testable in isolation.

## What Changes

- **New `Logger` interface** exported from `logger.ts` with `log(level, message, opts?)` signature
- **New `noopLogger` and `realLogger` constants** exported from `logger.ts` for use in tests and DI
- **`AnthropicProvider` constructor** gains an optional last parameter `logger?: Logger` (defaults to `realLogger`)
- **`_RetryTimingConfig`** in `retry.ts` gains `logger?: Logger` field (all existing callers unaffected — default covers them)
- **`compactMessages` opts** in `context.ts`: `quiet?: boolean` removed, replaced by `logger?: Logger` (two internal call sites updated from `{ quiet: true }` to `{ logger: noopLogger }`)
- **`session-memory.ts` internal logging** accepts an optional `Logger` parameter on `extractAndWriteSessionMemory`
- **`providers.test.ts`** passes `noopLogger` to `new AnthropicProvider(...)` — no DB setup required
- **`retry.test.ts`** adds `logger: noopLogger` to `_tc` objects — prevents edge-case DB hits on stall/rate-limit log paths

## Capabilities

### New Capabilities
- `injectable-logger`: A `Logger` interface + `noopLogger`/`realLogger` constants in `logger.ts` that allow AI-layer modules to receive their logging dependency rather than importing the global `log()` function directly.

### Modified Capabilities
- `mutation-testing`: Backend mutation dry-run now passes without DB setup — the test runner (Stryker + vitest) can exercise `AnthropicProvider` and `retryStream` paths that previously required a `logs` table.

## Impact

- **`src/bun/logger.ts`** — add interface + constants (non-breaking)
- **`src/bun/ai/anthropic.ts`** — new optional constructor param (non-breaking)
- **`src/bun/ai/retry.ts`** — extend `_RetryTimingConfig` (non-breaking, internal type)
- **`src/bun/conversation/context.ts`** — remove `quiet` flag, add `logger` opt (breaking for any callers using `quiet: true` — only 2 internal sites in same file)
- **`src/bun/workflow/session-memory.ts`** — optional logger param (non-breaking)
- **`src/bun/test/providers.test.ts`** — pass `noopLogger` to provider constructor
- **`src/bun/test/retry.test.ts`** — add `logger: noopLogger` to `_tc` in test calls
- No public API surface, no frontend changes, no DB schema changes
