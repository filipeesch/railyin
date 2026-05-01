## Why

The mutation test CI job fails with `no such table: logs` because `logger.ts` always writes to the SQLite `logs` table, but `providers.test.ts` tests pure HTTP/streaming behavior without setting up a DB schema. Any module that imports `log()` gains a hidden transitive DB dependency that silently crashes in DB-free test contexts. Fixing this properly requires injecting the logger so callers can opt out of DB logging in tests.

## What Changes

- `logger.ts` gains a `Logger` interface, a `noopLogger` constant, and a `realLogger` constant — no breaking changes to the existing `log()` function
- `AnthropicProvider` accepts an optional `logger?: Logger` as its last constructor parameter (defaults to `realLogger`)
- `_RetryTimingConfig` (internal to `retry.ts`) gains an optional `logger?: Logger` field, used by `retryStream` and `retryTurn`
- `compactMessages` in `context.ts` replaces `opts.quiet` with `opts.logger?: Logger` — the `quiet` flag is removed (**BREAKING** for callers passing `{ quiet: true }`, but all callers are internal to the file)
- `extractAndWriteSessionMemory` in `session-memory.ts` gains an optional `logger?: Logger` parameter
- `providers.test.ts` passes `noopLogger` to `new AnthropicProvider(…)` — no DB setup needed
- `retry.test.ts` adds `logger: noopLogger` to `_tc` objects to prevent edge-case DB hits

## Capabilities

### New Capabilities

- `di-logger`: Logger interface, `noopLogger`, and `realLogger` exports from `logger.ts`; injectable logger support across the AI provider and conversation layers

### Modified Capabilities

- `mutation-testing`: The backend mutation dry-run now passes (no more `no such table: logs` crash in `providers.test.ts`)

## Impact

- **`src/bun/logger.ts`** — additive: new exports only
- **`src/bun/ai/anthropic.ts`** — `AnthropicProvider` constructor gains optional 8th param
- **`src/bun/ai/retry.ts`** — `_RetryTimingConfig` gains `logger?` field; all `log(…)` calls inside `retryStream`/`retryTurn` use it
- **`src/bun/conversation/context.ts`** — `compactMessages` opts type changes; 2 internal callers updated
- **`src/bun/workflow/session-memory.ts`** — `extractAndWriteSessionMemory` gains optional `logger?` param
- **`src/bun/test/providers.test.ts`** — passes `noopLogger` to provider constructor
- **`src/bun/test/retry.test.ts`** — adds `logger: noopLogger` to `_tc` objects
- No changes to `ai/index.ts`, engine files, handlers, or any other production call sites
