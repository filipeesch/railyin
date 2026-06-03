## 1. Update cross-engine-context.test.ts (constructor migration)

- [ ] 1.1 Update all 10 existing CEC tests (`CEC-1` through `CEC-10`) to use `new CrossEngineContextInjector(db, registry)` — replace `makeSourceEngine()` spy injection via `prepareSwitch` param with a `makeTestRegistryWith(new Map([["copilot", spyEngine]]))` registry
- [ ] 1.2 Update `CEC-4` assertion to also verify the `compaction_summary` row appears as a `<SUMMARY>` block in the returned `historyBlock` (now included via `>=` anchor)

## 2. Add new CEC unit tests in cross-engine-context.test.ts

- [ ] 2.1 Add `CEC-15`: seed Pi assistant messages with `last_engine_type = "pi"`, switch to `"claude"`, assert `historyBlock` contains Pi content inside `<ASSISTANT>` tags
- [ ] 2.2 Add `CEC-16`: seed `compaction_summary` followed by Pi turns, switch to `"claude"`, assert `historyBlock` contains `<SUMMARY>` block from compaction row AND subsequent turns
- [ ] 2.3 Add `CEC-17`: append user message before calling `prepareSwitch` with `excludeBeforeMsgId = msgId`, assert user message content absent from `historyBlock`
- [ ] 2.4 Add `CEC-18`: `last_engine_type = "unknown-engine"` not in registry, assert injection proceeds without error and no `compact()` is called
- [ ] 2.5 Add `CEC-19`: seed messages from engine A, compaction_summary, messages from engine B, assert only engine B messages appear in `historyBlock`
- [ ] 2.6 Add `CEC-20`: seed only a `compaction_summary` with no subsequent messages, assert `historyBlock` contains only `<SUMMARY>` block

## 3. Add CE-15/16/17 in chat-executor.test.ts

- [ ] 3.1 Update `makeExecutor` helper to pass `EngineRegistry` to `CrossEngineContextInjector` constructor (was `new CrossEngineContextInjector(db)`, now `new CrossEngineContextInjector(db, makeTestRegistry(...))`)
- [ ] 3.2 Add `CE-15`: seed Pi assistant messages with `lastEngineType = "pi"`, execute with Claude model, assert `params.prompt` contains Pi message text inside `<ASSISTANT>` tags
- [ ] 3.3 Add `CE-16`: seed `compaction_summary` + post-compaction Pi turns with `lastEngineType = "pi"`, execute with Claude, assert `params.prompt` contains `<SUMMARY>` block
- [ ] 3.4 Add `CE-17`: seed prior copilot messages with `lastEngineType = "copilot"`, execute with Claude model, assert the literal user prompt content does NOT appear inside `<message_history>` in `params.prompt`

## 4. Add HT-CE tests in human-turn-executor.test.ts

- [ ] 4.1 Extend `makeExecutor` helper to accept optional `registry?: EngineRegistry` parameter; use it to construct `CrossEngineContextInjector(db, registry)`, falling back to `makeTestRegistry(engine)` when not provided
- [ ] 4.2 Add `HT-CE-1`: seed copilot messages, set `last_engine_type = "copilot"` and `conversation_model = "claude/sonnet"`, execute with Claude task, assert `params.prompt` contains `<message_history>`
- [ ] 4.3 Add `HT-CE-2`: seed large Pi session, set `last_engine_type = "pi"` and `conversation_model = "claude/sonnet"` (already updated), inject a Pi engine with `compact` spy and a Claude engine; assert `compact` called on Pi engine (BUG A regression guard)
- [ ] 4.4 Add `HT-CE-3`: seed prior engine messages, execute with engine switch, assert the current user message content (`"hello"`) does NOT appear inside `<message_history>` in `params.prompt`

## 5. Add TE-CE tests in transition-executor.test.ts

- [ ] 5.1 Extend the transition executor factory in tests to accept optional `registry?: EngineRegistry` parameter for multi-engine scenarios
- [ ] 5.2 Add `TE-CE-1`: seed copilot messages, set `last_engine_type = "copilot"`, transition with Claude model, assert `params.systemInstructions` contains `<message_history>` / engine-switch context header
- [ ] 5.3 Add `TE-CE-2`: seed large Pi session, `last_engine_type = "pi"`, `conversation_model = "claude/sonnet"`, inject Pi engine with `compact` spy; assert `compact` called on Pi engine (BUG A regression guard)

## 6. Verify

- [ ] 6.1 Run `bun test src/bun/test/cross-engine-context.test.ts --timeout 20000` — all CEC tests pass
- [ ] 6.2 Run `bun test src/bun/test/chat-executor.test.ts --timeout 20000` — all CE tests pass
- [ ] 6.3 Run `bun test src/bun/test/human-turn-executor.test.ts --timeout 20000` — all HT tests pass
- [ ] 6.4 Run `bun test src/bun/test/transition-executor.test.ts --timeout 20000` — all TE tests pass
- [ ] 6.5 Run `bun test src/bun/test --timeout 20000` — full backend suite green
