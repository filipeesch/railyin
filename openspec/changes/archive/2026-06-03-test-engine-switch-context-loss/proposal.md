## Why

The engine-switch context loss bug fix (`fix-engine-switch-context-loss`) changes `CrossEngineContextInjector`'s constructor signature and behavioral contract in ways that require updating 10 existing unit tests and adding 10 new tests across four test files. The test scope grew significantly during exploration: tests are needed not just in `chat-executor.test.ts` but also in `cross-engine-context.test.ts`, `human-turn-executor.test.ts`, and `transition-executor.test.ts`. This proposal tracks that full test suite as a standalone deliverable.

## What Changes

- **Update `cross-engine-context.test.ts`**: all 10 existing CEC tests must be updated for the new `CrossEngineContextInjector(db, engineRegistry)` constructor. Tests that previously passed `sourceEngine` directly to `prepareSwitch()` must now inject a registry with a capturing engine.
- **Add CEC-15/16/17** in `cross-engine-context.test.ts`: B→A round-trip context, compaction_summary inclusive anchor, in-flight message exclusion.
- **Add CEC-extra edge cases** in `cross-engine-context.test.ts`: unknown-engine in registry, three-way A→B→C switch, empty post-anchor (only compaction_summary exists).
- **Add HT-CE-1/2** in `human-turn-executor.test.ts`: engine-switch injection present (HT-CE-1) and BUG A regression guard — sourceEngine resolved from `last_engine_type` not `conversation_model` (HT-CE-2).
- **Add HT-CE-3** in `human-turn-executor.test.ts`: no duplication — current user message absent from `<message_history>`.
- **Add TE-CE-1/2** in `transition-executor.test.ts`: engine-switch injection in `systemInstructions` (TE-CE-1) and BUG A regression guard (TE-CE-2).
- **Update `makeExecutor` test helpers** in `human-turn-executor.test.ts` and `transition-executor.test.ts` to accept an optional `EngineRegistry` for multi-engine scenarios — uses the existing (currently unused) `makeTestRegistryWith` helper.

## Capabilities

### New Capabilities

*(none — this is test coverage only)*

### Modified Capabilities

- `test-cross-engine-context`: Scenarios extended for inclusive compaction anchor, B→A round-trip, message deduplication, unknown engine in registry, multi-switch chain, and new executor-level scenarios (HT-CE-*, TE-CE-*).

## Impact

- `src/bun/test/cross-engine-context.test.ts` — update all 10 CEC tests + add 6 new
- `src/bun/test/chat-executor.test.ts` — update `makeExecutor` + add CE-15/16/17
- `src/bun/test/human-turn-executor.test.ts` — extend `makeExecutor`, add HT-CE-1/2/3
- `src/bun/test/transition-executor.test.ts` — extend executor factory, add TE-CE-1/2
- No production code changes. No API or schema changes. No Playwright changes.
