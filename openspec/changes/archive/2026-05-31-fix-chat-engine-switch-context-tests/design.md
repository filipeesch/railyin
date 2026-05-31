## Context

The `fix-chat-engine-switch-context` change introduces three behavioral additions to `ChatExecutor`:
1. `CrossEngineContextInjector` wired in via DI → `prepareSwitch()` called each turn
2. `conversations.last_engine_type` written after `runNonNative()`
3. Model-update condition fixed (`!modelValue` → `!== modelValue`)

None of these are covered by any existing test. The existing `chat-executor.test.ts` (CE-1..CE-7) covers pre-flight, context window override, and boardTools — all unrelated to engine switching. The injector itself is fully covered by `cross-engine-context.test.ts` (CEC-1..CEC-11), so the new tests focus purely on the `ChatExecutor` integration layer.

## Goals / Non-Goals

**Goals:**
- Test every scenario from the `cross-engine-context-injection` delta spec that applies to chat execution
- Keep infrastructure changes minimal: extend `seedChatSession` and `makeExecutor` factory, add `makeTestRegistryWith`
- All new tests use in-memory DB (same as CE-1..CE-7) — no mocking of the injector itself

**Non-Goals:**
- Re-testing `CrossEngineContextInjector` internals (already covered by CEC-* tests)
- Playwright/E2E tests — the feature is backend-only and invisible to the frontend
- Testing the injector's compaction path in full depth (covered by CEC-7)

## Decisions

### Use real `CrossEngineContextInjector` in chat-executor tests, not a stub
The injector is a pure DB-reading component with no side-effects beyond querying `conversation_messages`. Using a real instance keeps tests honest and avoids a mock interface that would need to be maintained. The CEC-* tests already validate injector internals; the CE-* tests only need to assert the executor integrates it correctly.

**Alternative considered**: Inject a stub implementing `ICrossEngineContextInjector`. Rejected because it would require adding a new interface to production code solely for testability, which violates the constraint against production changes just for testing.

### Extend `seedChatSession` rather than add raw SQL per test
Seven new tests need `last_engine_type` set on the seeded conversation. Putting the SQL in each test is noise and fragile. A `lastEngineType?: string | null` override param follows the existing `overrides` pattern and is a pure test-infrastructure change with zero production impact.

### Add `makeTestRegistryWith(engines: Map<string, ExecutionEngine>)` as an optional complement
`makeTestRegistry` always registers the engine under the config's first engine ID. For CE-8 (source engine resolution via `getEngineById`), the registry must have a `"copilot"` entry — which the existing helper already provides. `makeTestRegistryWith` is added for future multi-engine scenarios but is not strictly required for CE-8..CE-14.

## Risks / Trade-offs

- **[Risk]** `seedChatSession` signature change could break callers passing positional args.
  → **Mitigation**: The override is additive inside the existing `overrides` object — no positional change, full backward compat.

- **[Risk]** CE-12 "overwrite on switch" test needs two sequential `executor.execute()` calls. The second call with `"claude/..."` will fall back to the registered `"copilot"` engine (since the test registry has no `"claude"` entry), but `engineId` is derived from `QualifiedModelId.tryParse()` independently of registry resolution. The `last_engine_type` write uses the parsed `engineId`, not the resolved engine. So the assertion on `"claude"` is correct even with a single-engine registry.
  → **No mitigation needed** — the design is sound.
