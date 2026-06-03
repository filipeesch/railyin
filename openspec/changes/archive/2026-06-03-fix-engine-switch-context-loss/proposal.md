## Why

When a user switches engines mid-conversation (e.g. Claude → Pi → Claude), the context from the intermediate engine session is not reliably carried back to the original engine. This was traced to two layered bugs in `CrossEngineContextInjector` and its callers that together silently wipe the injected history block under common conditions.

## What Changes

- **Fix `CrossEngineContextInjector.fetchMessagesSinceAnchor`**: change strict `id > anchor` query to inclusive `id >= anchor` so that `compaction_summary` rows (Pi's background compaction output) are fetched and rendered as `<SUMMARY>` blocks.
- **Refactor `CrossEngineContextInjector` to own source-engine resolution**: inject `EngineRegistry` into the constructor and remove the `sourceEngine` parameter from `prepareSwitch()`. This eliminates the bug in `human-turn-executor` and `transition-executor` where `sourceEngine` was accidentally resolved from the target model instead of `last_engine_type`.
- **Fix current user message duplication**: `appendMessage` is called before `prepareSwitch` in both `chat-executor` and `human-turn-executor`, causing the current user message to appear in both the `<message_history>` block and the main prompt. Pass the new message ID as an `excludeBeforeMsgId` upper bound so the just-stored message is excluded from history injection.
- **Merge three `CrossEngineContextInjector` instances into one**: `orchestrator.ts` creates three separate (stateless) instances — consolidate to a single shared instance.
- **Test suite**: all test changes are tracked in the companion proposal `test-engine-switch-context-loss`. See that change for full test scope across `cross-engine-context.test.ts`, `chat-executor.test.ts`, `human-turn-executor.test.ts`, and `transition-executor.test.ts`.

## Capabilities

### New Capabilities

*(none — this is a bug fix with no new user-facing capabilities)*

### Modified Capabilities

- `cross-engine-context-injection`: Requirements change to cover inclusive compaction_summary anchor fetch, source-engine resolution moving inside the injector, and exclusion of the in-flight user message from history injection.
- `test-cross-engine-context`: Test specs are tracked in the companion change `test-engine-switch-context-loss`.

## Impact

- **`src/bun/conversation/cross-engine-context.ts`**: constructor gains `EngineRegistry` param; `prepareSwitch` drops `sourceEngine` param and gains optional `excludeBeforeMsgId`; anchor query changes from `>` to `>=`.
- **`src/bun/engine/execution/chat-executor.ts`**: remove `sourceEngine` locals; pass `msgId` to `prepareSwitch`.
- **`src/bun/engine/execution/human-turn-executor.ts`**: same removal + pass `msgId`.
- **`src/bun/engine/execution/transition-executor.ts`**: remove `sourceEngine` only (no `msgId` needed).
- **`src/bun/engine/orchestrator.ts`**: single shared `CrossEngineContextInjector` instance.
- No schema migrations, no API/RPC changes, no frontend changes.
- Test file changes: see companion change `test-engine-switch-context-loss`.
