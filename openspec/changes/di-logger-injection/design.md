## Context

`logger.ts` exposes a single `log()` function that unconditionally calls `getDb().run("INSERT INTO logs …")`. Every module that imports it gains a hidden transitive dependency on the SQLite schema being fully initialized. This is invisible at import time and only fails at runtime when the `logs` table is missing.

The mutation test runner (Stryker + Vitest) executes `providers.test.ts` in a fork with no DB setup. `AnthropicProvider.stream()` calls `logUsage()` on every `message_stop` event, which calls `log()`, which crashes with `no such table: logs`. The fix is to make the DB-writing behavior injectable so test contexts can opt out.

The four production files affected are: `ai/anthropic.ts`, `ai/retry.ts`, `conversation/context.ts`, and `workflow/session-memory.ts`.

## Goals / Non-Goals

**Goals:**
- Make `providers.test.ts` and `retry.test.ts` runnable without DB schema setup
- Introduce a `Logger` interface and `noopLogger` so callers can opt out of DB logging
- Keep all production behavior identical — default injection resolves to the real DB logger
- Remove the redundant `quiet` flag from `compactMessages` in favour of `logger: noopLogger`
- Follow SOLID DIP: high-level modules depend on an abstraction, not the concrete DB logger

**Non-Goals:**
- Replacing `console.log` calls in the codebase
- Making the `logs` DB table optional in production
- Injecting the logger into engine files, handlers, or orchestrator (they don't call `log()` directly)
- Adding a logging framework or structured log sink

## Decisions

### D1: Logger interface lives in `logger.ts` (not a new file)

`logger.ts` already owns the `LogLevel`, `LogOptions`, and `log()` types. Adding `Logger`, `noopLogger`, and `realLogger` there keeps all logging concerns co-located.

Alternatives considered:
- Separate `logger-types.ts`: unnecessary split for a 3-line interface
- Separate `noop-logger.ts`: overengineered for the scope

### D2: `_RetryTimingConfig` carries the logger (not a separate param)

`_RetryTimingConfig` is already the test seam in `retry.ts`. All test callers pass it as positional arg 6. Adding `logger?` there requires zero changes to the 8-parameter `retryStream` and `retryTurn` signatures and zero changes to production callers who pass `{}`.

Alternatives considered:
- 9th explicit param on `retryStream`/`retryTurn`: too verbose, all positional callers must be updated
- Via `AICallOptions`: couples a cross-cutting concern to an AI-specific type

### D3: `AnthropicProvider` gets logger as 8th optional constructor param

The constructor already has 7 params. The logger is last and optional, defaulting to `realLogger`. `ai/index.ts` `instantiateProvider` needs no change. Tests construct `AnthropicProvider` directly and pass `noopLogger`.

### D4: `compactMessages` `quiet` flag is removed, replaced by `logger?: Logger`

`quiet: true` was only used in 2 internal callers in `context.ts` to suppress the one `log()` call. Replacing it with `logger: noopLogger` is semantically cleaner and eliminates a redundant API surface.

### D5: `session-memory.ts` injects via function parameter

The public `extractAndWriteSessionMemory` function gets an optional `logger?: Logger` parameter. Production callers don't pass it (default = `realLogger`). If tests exercise this path, they pass `noopLogger`.

## Risks / Trade-offs

- **Inconsistency risk**: Some `log()` calls in the codebase stay as-is (engine files, handlers, orchestrator don't import `logger.ts` directly). The DI pattern is applied only to the 4 files that need it now. → Mitigation: The pattern is incremental; future files can adopt it if they need testability without DB.

- **Default coupling**: If a developer adds a new `log()` call inside `AnthropicProvider` and doesn't use `this.logger`, the hidden DB dependency returns. → Mitigation: ESLint rule or code review — `log(` bare import should be flagged inside injected-logger files.

- **`_RetryTimingConfig` semantics**: The interface mixes timing concerns with a logger. → Mitigation: The interface is `_`-prefixed (internal), so semantic purity is less critical; the tradeoff is justified by zero signature changes.

## Migration Plan

All changes are backward-compatible additive or internal-only:
1. Add `Logger`, `noopLogger`, `realLogger` to `logger.ts`
2. Update `anthropic.ts`, `retry.ts`, `context.ts`, `session-memory.ts` to use injected logger internally
3. Update `providers.test.ts` and `retry.test.ts` to pass `noopLogger`
4. Verify `bun test src/bun/test --timeout 20000` passes
5. Verify `npx stryker run stryker.backend.json --mutate "src/bun/ai/anthropic.ts"` dry-run passes

No rollback strategy needed — all changes are additive with optional parameters.

## Open Questions

None — all design decisions were confirmed during exploration.
