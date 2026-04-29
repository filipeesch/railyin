## 1. Test Infrastructure

- [x] 1.1 Extend `setupTestConfig` in `src/bun/test/helpers.ts` to accept `engineModel?: string | null` option — `null` omits the `model:` line, `undefined` preserves default `copilot/mock-model`

## 2. Unit Tests — model-resolver

- [x] 2.1 Create `src/bun/test/model-resolver.test.ts` with scenarios R-1 through R-7: priority chain (column → task → engine → ""), EngineConfig union guard (no model field), and empty-string fallthrough via `||`

## 3. Integration Tests — handlers

- [x] 3.1 Extend `src/bun/test/handlers.test.ts` tasks.create section with TC-1 (engine.model seeded to new task) and TC-2 (no engine.model → task model is NULL)

## 4. Integration Tests — TransitionExecutor

- [x] 4.1 Extend `src/bun/test/transition-executor.test.ts` with T-3 through T-6: engine.model fallback (regression for the original bug), task model preserved, column model wins, no engine model returns ""

## 5. Integration Tests — HumanTurnExecutor

- [x] 5.1 Create `src/bun/test/human-turn-executor.test.ts` with DI stubs (CapturingParamsBuilder, StubStreamProcessor, StubWorkdirResolver, TestEngine with throwOnResume option)
- [x] 5.2 Add HT-1 through HT-4: normal path model resolution + DB write-back, task model preserved, no engine model, engine-lost fallback path

## 6. Integration Tests — RetryExecutor

- [x] 6.1 Create `src/bun/test/retry-executor.test.ts` with DI stubs mirroring the HumanTurnExecutor test file
- [x] 6.2 Add RT-1 through RT-3: model resolution + DB write-back, task model preserved, no engine model

## 7. Playwright — model seeding visible in UI

- [x] 7.1 Extend `e2e/ui/extended-chat.spec.ts` suite Q with Q-20: tasks.create returns task with engine-seeded model → chat drawer model selector shows correct model
