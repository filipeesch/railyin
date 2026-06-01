## Why

The `fix-chat-engine-switch-context` implementation adds engine-switch context preservation to `ChatExecutor`, but the new behaviour has no test coverage. Without tests, regressions in `last_engine_type` tracking, history injection, and the Pi pre-flight guard will go undetected.

## What Changes

- New test groups `CE-8` through `CE-14` added to `src/bun/test/chat-executor.test.ts`, covering every scenario defined in the `cross-engine-context-injection` delta spec.
- `seedChatSession` in `src/bun/test/helpers.ts` gains an optional `lastEngineType` parameter to avoid raw SQL in each test.
- `makeExecutor` factory in `chat-executor.test.ts` gains an optional `crossEngineInjector` parameter to support DI of the injector.
- Optional `makeTestRegistryWith(engines: Map<string, ExecutionEngine>)` added to `helpers.ts` for multi-engine registry scenarios.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `cross-engine-context-injection`: Add test scenarios for the chat execution path — the delta spec introduced 6 scenarios and 3 requirements that have no corresponding tests yet.

## Impact

- **`src/bun/test/chat-executor.test.ts`** — 7 new test groups (CE-8..CE-14), updated `makeExecutor` factory.
- **`src/bun/test/helpers.ts`** — `seedChatSession` extended with `lastEngineType`; `makeTestRegistryWith` added.
- No production code changes. No API, DB, or frontend changes.
