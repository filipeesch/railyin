## 1. Refactor CrossEngineContextInjector

- [x] 1.1 Add `EngineRegistry` to `CrossEngineContextInjector` constructor in `src/bun/conversation/cross-engine-context.ts`
- [x] 1.2 Remove `sourceEngine` parameter from `prepareSwitch()` and resolve it internally from `last_engine_type` via `engineRegistry.getEngineById()`
- [x] 1.3 Fix `fetchMessagesSinceAnchor` query: change `id > ?` to `id >= ?` to include the compaction_summary anchor row
- [x] 1.4 Add optional `excludeBeforeMsgId?: number` parameter to `prepareSwitch()` and `fetchMessagesSinceAnchor()`; when provided, add `AND id < ?` clause to exclude the in-flight user message

## 2. Update Orchestrator

- [x] 2.1 In `src/bun/engine/orchestrator.ts`, replace the three separate `new CrossEngineContextInjector(db)` instantiations with a single shared `crossEngineInjector = new CrossEngineContextInjector(db, registry)` and pass it to all three executors

## 3. Update Executors

- [x] 3.1 In `src/bun/engine/execution/chat-executor.ts`, remove `lastEngineType`/`sourceEngine` local variables and update `prepareSwitch()` call to remove `sourceEngine` and pass `msgId` as `excludeBeforeMsgId`
- [x] 3.2 In `src/bun/engine/execution/human-turn-executor.ts`, remove `sourceEngine` local variable and update `prepareSwitch()` call to remove `sourceEngine` and pass `msgId` as `excludeBeforeMsgId`
- [x] 3.3 In `src/bun/engine/execution/transition-executor.ts`, remove `sourceEngine` local variable and update `prepareSwitch()` call to remove `sourceEngine` (no `excludeBeforeMsgId` needed — transition events are filtered by `formatHistoryBlock`)

## 4. Tests

See companion change `test-engine-switch-context-loss` for the full test task breakdown.

- [x] 4.1 Implement all test updates and new tests as specified in `test-engine-switch-context-loss/tasks.md`
- [x] 4.2 Run the full backend test suite and confirm all tests pass: `bun test src/bun/test --timeout 20000`
