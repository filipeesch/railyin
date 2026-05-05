## Why

The `multi-engine-workspace-support` feature introduces new production modules (`QualifiedModelId`, `EngineRegistry` multi-engine API, `CrossEngineContextInjector`, `engines.yaml` loader) and reworks existing test infrastructure (`BackendRpcRuntime`, `EngineRegistry.fromFixed()` removal). Without a dedicated test suite, these changes have no coverage and regressions in context-injection or engine-routing logic would go undetected.

## What Changes

- New unit test file: `src/bun/test/qualified-model-id.test.ts` — pure value-object tests, no deps
- New unit test file: `src/bun/test/engines-config.test.ts` — config loading, backward compat, `allowed_engines` filtering
- New unit test file: `src/bun/test/engine-registry-multi.test.ts` — replaces `engine-registry.test.ts`; tests new Map-based DI API
- New unit test file: `src/bun/test/cross-engine-context.test.ts` — injection trigger, compaction threshold, Claude no-compact path
- New integration test file: `src/bun/test/multi-engine-execution.test.ts` — end-to-end execution routing with two mock engines in `BackendRpcRuntime`
- New unit test file: `src/bun/test/model-resolver-multi.test.ts` — conversation model seeding from first engine
- New Playwright spec: `e2e/ui/model-picker-multi-engine.spec.ts` — model picker grouping, OpenCode ID persistence, `allowed_engines` UI filter
- **BREAKING** Remove `engine-registry.test.ts` — superseded by `engine-registry-multi.test.ts`
- **BREAKING** Delete `src/bun/test/model-resolver.test.ts` — empty file, leftover from prior implementation
- Refactor `src/bun/test/helpers.ts` — add `enginesYaml?` param to `setupTestConfig()` for multi-engine test config
- Refactor `src/bun/test/support/backend-rpc-runtime.ts` — accept injected `EngineRegistry` instead of internally calling `EngineRegistry.fromFixed()`; add `makeRegistry()` convenience helper in `helpers.ts`

## Capabilities

### New Capabilities
- `test-qualified-model-id`: Unit tests for `QualifiedModelId` value object — parse, nativeModelId, round-trip, error cases
- `test-engines-config`: Unit tests for `engines.yaml` loading — presence, absence, backward compat, allowed_engines filtering
- `test-engine-registry-multi`: Unit tests for the new Map-based `EngineRegistry` — routing, fallback, cancelAll, shutdown, allowed_engines
- `test-cross-engine-context`: Unit + integration tests for `CrossEngineContextInjector` — trigger conditions, compaction, Claude no-compact path, last_engine_type persistence
- `test-multi-engine-execution`: Integration tests via `BackendRpcRuntime` — two-engine routing, model seeding, listModels aggregation
- `test-model-picker-ui`: Playwright tests for model picker grouping and OpenCode model ID persistence

### Modified Capabilities
- `test-infra`: `setupTestConfig()` extended with `enginesYaml?`; `BackendRpcRuntime` now accepts `EngineRegistry` by injection; `makeRegistry()` helper added

## Impact

- No production code changes — test infrastructure refactors only (except `fromFixed()` removal which is a production static method on `EngineRegistry`)
- `EngineRegistry.fromFixed()` removal touches `BackendRpcRuntime` (single call site); all other test files that used `fromFixed()` are replaced by the new test files
- Playwright mocks: `models.listEnabled` stubs in `mock-api.ts` gain OpenCode model entries in new spec file — no changes to existing Playwright specs
