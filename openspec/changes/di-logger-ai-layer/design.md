## Context

`logger.ts` exposes a single `log()` function that writes directly to the `logs` SQLite table via `getDb()`. This makes every module that imports `logger.ts` transitively dependent on a fully-initialized database. `AnthropicProvider` and `retryStream` both call `log()` on normal operational paths (usage stats on every `message_stop`, retry warnings on 429/stall events). The Stryker backend mutation suite runs tests via vitest with `perTest` coverage — `providers.test.ts` tests pure HTTP streaming and has no DB setup, so the first log call crashes the dry-run with `no such table: logs`, aborting the entire mutation run.

Current logger coupling chain:
```
providers.test.ts
  → AnthropicProvider.stream()
    → logUsage()
      → log()
        → getDb().run("INSERT INTO logs …")  ← CRASH
```

## Goals / Non-Goals

**Goals:**
- Fix the Stryker mutation dry-run failure without requiring DB setup in provider/retry tests
- Introduce a `Logger` interface that AI-layer modules accept as an optional constructor/config parameter
- Keep production behavior unchanged: all real callers continue writing to the `logs` table
- Remove the `quiet` flag on `compactMessages` (redundant once logger is injectable)
- Keep the change minimal and non-breaking for all existing call sites

**Non-Goals:**
- Full DI overhaul of the entire codebase — only the 4 files that directly import `logger.ts` in production (outside tests)
- Abstracting `console.log` output — `realLogger` wraps the existing `log()` function as-is
- Performance optimization of the logger
- Changing the `logs` DB schema

## Decisions

### Decision: `Logger` interface lives in `logger.ts`, not a separate file
**Rationale**: The interface is trivially small and co-locating it with `realLogger` and `noopLogger` means consumers import one thing from one place. A separate `src/bun/ai/logger-types.ts` file would add indirection with no benefit at this scope.

### Decision: `_RetryTimingConfig` carries the logger for `retryStream`/`retryTurn`
**Alternatives considered**:
- *Explicit last param*: would be 9th param on `retryStream` — already positional and fragile
- *`AICallOptions.logger`*: couples a cross-cutting concern to the AI call contract; `AICallOptions` is a public shared type

`_RetryTimingConfig` is already the established test-seam for timing parameters. Semantically, `logger` is another "test override" — it follows the existing pattern. All production callers pass `{}` or `{ baseBackoffMs: 0 }` so they get `realLogger` via default.

### Decision: Replace `compactMessages` `quiet` flag with `logger?: Logger`
**Rationale**: `quiet: true` existed solely to suppress the `log("warn", ...)` call during compaction where orphan warnings are expected noise. With a `Logger` parameter, passing `{ logger: noopLogger }` is more explicit and the `quiet` flag becomes dead code. The two internal call sites are both in `context.ts` — no external callers pass `quiet`.

### Decision: `AnthropicProvider` logger is the last constructor parameter (optional)
**Rationale**: The constructor already has 7 params and is only instantiated in one production location (`ai/index.ts:44`). Making it last and optional means zero changes to `instantiateProvider()` — the default is `realLogger`. Tests that construct `AnthropicProvider` directly pass `noopLogger` as the 8th argument.

### Decision: `session-memory.ts` receives logger via function param, not module-level injection
**Rationale**: Session memory extraction is a background side-effect, not a core AI call. The public API (`extractAndWriteSessionMemory`) gains an optional `logger?: Logger` parameter. This is consistent with how `compactMessages` works.

## Risks / Trade-offs

- **[Risk] New test files that exercise logging paths skip DB setup** → Mitigation: `noopLogger` defaults to `realLogger` in production. The pattern is now documented — new tests for logging-heavy modules should pass `noopLogger` explicitly.
- **[Risk] `quiet` removal is technically breaking** → Mitigation: grep confirms only 2 internal usages of `{ quiet: true }` in `context.ts` itself. No external callers. Migration is zero-effort.
- **[Trade-off] `_RetryTimingConfig` mixes timing and logger** → Accepted. This is a test-internal type (prefixed `_`) and the alternative (adding a 9th positional param) is worse.

## Migration Plan

1. Extend `logger.ts` — additive only, no changes to existing exports
2. Update `anthropic.ts` — last param, all existing construction unaffected
3. Update `retry.ts` — `_RetryTimingConfig` field, all existing callers unaffected
4. Update `context.ts` — replace `quiet` with `logger`; update 2 internal call sites
5. Update `session-memory.ts` — optional param, all existing callers unaffected
6. Update `providers.test.ts` — pass `noopLogger`; confirm no DB setup needed
7. Update `retry.test.ts` — add `logger: noopLogger` to `_tc` objects
8. Run `bun test src/bun/test --timeout 20000` — verify all tests pass
9. Run Stryker dry-run smoke test — verify mutation suite starts cleanly

No rollback concerns — all changes are additive or internal-only.
