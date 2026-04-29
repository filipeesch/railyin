## Why

The `fix-default-workspace-model` implementation change introduces a new `resolveTaskModel()` utility and modifies three executors plus the `tasks.create` handler — all logic paths that currently have no dedicated test coverage. Without tests, regressions in the model resolution chain (the primary bug vector) would go undetected.

## What Changes

- **New** `src/bun/test/model-resolver.test.ts` — unit tests for the pure `resolveTaskModel()` utility, including priority chain, empty-string fallthrough, and `EngineConfig` guard.
- **New** `src/bun/test/human-turn-executor.test.ts` — integration tests for `HumanTurnExecutor` model resolution and DB write-back on both execution paths (normal and waiting_user engine-lost fallback).
- **New** `src/bun/test/retry-executor.test.ts` — integration tests for `RetryExecutor` model resolution and DB write-back.
- **Extended** `src/bun/test/handlers.test.ts` — two new `tasks.create` tests verifying model seeding with and without `engine.model` configured.
- **Extended** `src/bun/test/transition-executor.test.ts` — four new model-resolution scenarios covering the full priority chain including the `engine.model` fallback.
- **Extended** `e2e/ui/extended-chat.spec.ts` (suite Q) — one Playwright test verifying that a newly created task shows the engine-seeded model in the chat drawer model selector.
- **Extended** `src/bun/test/helpers.ts` — add `engineModel?: string | null` option to `setupTestConfig()` to support the "no engine model" test scenario without breaking existing tests.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `model-selection`: Add test scenarios covering the priority chain (`column → task → engine.model → ""`), empty-string fallthrough (`||` semantics), DB write-back in `HumanTurnExecutor`/`RetryExecutor`, conditional seeding at `tasks.create`, and the `EngineConfig` union guard. These scenarios validate all requirements introduced by `fix-default-workspace-model`.

## Impact

- **`src/bun/test/model-resolver.test.ts`** — new file, pure unit tests
- **`src/bun/test/human-turn-executor.test.ts`** — new file, integration tests with in-memory DB
- **`src/bun/test/retry-executor.test.ts`** — new file, integration tests with in-memory DB
- **`src/bun/test/handlers.test.ts`** — extend `tasks.create` describe block
- **`src/bun/test/transition-executor.test.ts`** — extend with 4 model-resolution tests
- **`src/bun/test/helpers.ts`** — add `engineModel` option to `setupTestConfig`
- **`e2e/ui/extended-chat.spec.ts`** — extend suite Q with Q-20
- No production code changes; no DB schema changes; no API changes
