## 1. Test Infrastructure Refactoring

- [ ] 1.1 Delete `src/bun/test/model-resolver.test.ts` (1-byte empty file, leftover)
- [ ] 1.2 Delete `src/bun/test/engine-registry.test.ts` (superseded by new multi-engine test file)
- [ ] 1.3 Update `initDb()` in `src/bun/test/helpers.ts` — add `last_engine_type TEXT NULL` column to the hardcoded `conversations` DDL
- [ ] 1.4 Extend `setupTestConfig()` in `src/bun/test/helpers.ts` — add optional `enginesYaml?: string` param; write file to configDir when provided
- [ ] 1.5 Add `makeRegistry(engine, getConfig)` convenience helper in `src/bun/test/helpers.ts`
- [ ] 1.6 Refactor `src/bun/test/support/backend-rpc-runtime.ts` — replace `createEngine` callback + internal `EngineRegistry.fromFixed()` call with an injected `engineRegistry: EngineRegistry` parameter; update all call sites (~6 test files)

## 2. Unit Tests — Value Object and Config

- [ ] 2.1 Create `src/bun/test/qualified-model-id.test.ts` covering QMI-1 through QMI-9 (parse, nativeModelId, round-trip, error cases, value equality)
- [ ] 2.2 Create `src/bun/test/engines-config.test.ts` covering EC-1 through EC-8 (3-engine load, first-is-default, backward compat, both-files warning, allowed_engines filter, unknown id warning, empty list throws)

## 3. Unit Tests — EngineRegistry

- [ ] 3.1 Create `src/bun/test/engine-registry-multi.test.ts` covering ER-1 through ER-10 (routing by prefix, unknown-prefix fallback, allowed_engines filter, listAllEngines, cancelAll, shutdown, singleton across workspaces)

## 4. Unit + Integration Tests — CrossEngineContextInjector

- [ ] 4.1 Create `src/bun/test/cross-engine-context.test.ts` covering CEC-1 through CEC-11:
  - Injection trigger: same engine (no-op), null last_engine_type (no-op), engine change (injects)
  - Context content: messages since last compaction_summary anchor
  - last_engine_type persistence: success path, failure path
  - Compaction threshold: no contextWindow (skip), under 75% (no compact), over 75% with compact(), over 75% without compact (Claude warning)
  - systemInstructions placement: injected block precedes existing instructions

## 5. Integration Tests — Multi-Engine Execution

- [ ] 5.1 Create `src/bun/test/multi-engine-execution.test.ts` using `BackendRpcRuntime` with a two-engine registry:
  - ME-1 to ME-4: routing by model prefix (copilot, claude, opencode, two tasks in parallel)
  - ME-5: null model seeded from engines[0] on first execution
  - ME-6 to ME-7: `listModels()` aggregation and `allowed_engines` filter
  - ME-8: column transition seeds model from default engine

## 6. Playwright E2E Tests

- [ ] 6.1 Create `e2e/ui/model-picker-multi-engine.spec.ts` covering MP-1 through MP-5:
  - MP-1: models grouped by engine prefix in picker
  - MP-2: search filters across all engine groups
  - MP-3: opencode model ID persists as full qualified string via `tasks.setModel` / `chatSessions.setModel` mock
  - MP-4: `allowed_engines` UI filter (only copilot group visible)
  - MP-5: engine context visible in picker trigger after selection
- [ ] 6.2 Write and run e2e tests for multi-engine model picker
