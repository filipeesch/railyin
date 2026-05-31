## 1. Test Infrastructure

- [x] 1.1 Extend `seedChatSession` in `src/bun/test/helpers.ts` to accept optional `lastEngineType` override and write it to `conversations.last_engine_type`
- [x] 1.2 Add `makeTestRegistryWith(engines: Map<string, ExecutionEngine>): EngineRegistry` export to `src/bun/test/helpers.ts`
- [x] 1.3 Add optional `crossEngineInjector?: CrossEngineContextInjector` parameter to the `makeExecutor` factory in `src/bun/test/chat-executor.test.ts`; default to `new CrossEngineContextInjector(db)` when the injector parameter is omitted but a real one is needed (pass `undefined` to keep existing tests unchanged)

## 2. CE-8: History block injection on engine switch

- [x] 2.1 Add test: `params.prompt` contains `<message_history>` when `last_engine_type` differs from target engine
- [x] 2.2 Add test: `params.prompt` starts with `"## Context from previous conversation (engine switch)"` on switch

## 3. CE-9: No injection when engine unchanged

- [x] 3.1 Add test: `params.prompt` equals raw content when `last_engine_type` matches target engine

## 4. CE-10: No injection on first turn

- [x] 4.1 Add test: `params.prompt` equals raw content when `last_engine_type` is null

## 5. CE-11: History block not stored in conversation_messages

- [x] 5.1 Add test: `conversation_messages` user row `content` equals original input string, not injected prompt

## 6. CE-12: last_engine_type written after turn

- [x] 6.1 Add test: `conversations.last_engine_type` equals `"copilot"` after executing with `"copilot/mock-model"`
- [x] 6.2 Add test: `conversations.last_engine_type` equals `"claude"` after a second execute with `"claude/claude-sonnet-4-5"` following a copilot turn

## 7. CE-13: last_engine_type not written on Pi pre-flight failure

- [x] 7.1 Add test: `conversations.last_engine_type` unchanged when Pi pre-flight exits early (no context window)

## 8. CE-14: Model-update condition fix

- [x] 8.1 Add test: `conversations.model` updated to `"copilot/v2"` when executed with that model while `conversations.model` was previously `"copilot/v1"`

## 9. Verification

- [x] 9.1 Run `bun test src/bun/test/chat-executor.test.ts --timeout 20000` — all CE-1..CE-14 tests green
- [x] 9.2 Run full backend suite `bun test src/bun --timeout 20000` — no regressions
