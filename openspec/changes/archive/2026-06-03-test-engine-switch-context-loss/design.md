## Context

The `fix-engine-switch-context-loss` change modifies `CrossEngineContextInjector` in three ways that break its existing test contract:

1. **Constructor** changes from `(db)` to `(db, engineRegistry)` — all 10 existing CEC tests need updating.
2. **`prepareSwitch` drops `sourceEngine` param** — tests that verify compaction threshold (CEC-5..8) previously passed a spy engine directly; they must now inject a registry whose engine holds the spy.
3. **`fetchMessagesSinceAnchor` changes to `>=`** — CEC-4 must be updated to assert the compaction_summary row IS now included.

Additionally, exploration revealed that `human-turn-executor.test.ts` and `transition-executor.test.ts` have no engine-switch tests at all, leaving the BUG A regression path completely uncovered.

## Goals / Non-Goals

**Goals:**
- Update all CEC tests for the new constructor signature and `prepareSwitch` interface.
- Prove the BUG B fix (`>=` anchor) with CEC-16 (compaction_summary returns as `<SUMMARY>`).
- Prove the BUG A fix with HT-CE-2 and TE-CE-2 (regression guards: sourceEngine resolves from `last_engine_type`).
- Cover the deduplication fix with CE-17/HT-CE-3.
- Cover three additional edge cases discovered during exploration (unknown engine, switch chain, empty post-anchor).
- Keep all tests using DI (no monkeypatching, no module mocking).

**Non-Goals:**
- Playwright/e2e tests — the injected prompt is not observable in the UI without new debug endpoints.
- Tests for the Pi background compaction mechanism itself (covered by `pi-compaction-unit-tests`).
- Coverage for the retry/fallback path in `human-turn-executor` (lines 72–139, no `prepareSwitch` invocation there).

## Decisions

### Decision: Use `makeTestRegistryWith` for multi-engine CEC tests

The existing `makeTestRegistryWith(engines: Map<string, ExecutionEngine>)` helper in `helpers.ts` is currently unused. CEC tests that need to verify `sourceEngine.compact()` is called (or not) now create a two-engine registry where one engine holds the `compact` spy and `last_engine_type` points to it. This approach:
- Is already idiomatic to the test codebase.
- Requires no new helper infrastructure.
- Tests the exact production path (engine looked up by type ID from registry).

### Decision: Extend `makeExecutor` helpers with optional `registry` param

The `makeExecutor` factory functions in `human-turn-executor.test.ts` and `transition-executor.test.ts` currently accept only a `TestEngine` and build a single-engine registry internally. For HT-CE-* and TE-CE-* tests, we need two engines in the registry (source + target). The helpers will accept an optional `registry?: EngineRegistry` parameter, falling back to `makeTestRegistry(engine)` when not provided — preserving all existing tests unchanged.

This is a pure test helper refactoring with no production impact, and it has value as it keeps tests honest about how the production code wires up.

### Decision: No Playwright coverage for engine-switch context

The injected `<message_history>` block is passed to the AI engine's `execute()` params, which are:
- Never returned to the frontend.
- Intercepted by WsMock in Playwright tests.
- Never rendered in any DOM element.

A Playwright test could only verify that selecting a different model doesn't error the UI — already covered by `model-picker-multi-engine.spec.ts`. Adding Playwright tests here would require adding a debug API endpoint purely for testing, which violates the constraint of no code changes just for testing.

## Risks / Trade-offs

- **10 CEC test updates for constructor change** — mechanical but tedious. If done carelessly the tests may pass vacuously. Each updated test should still assert the same behavioral outcome, just with the new wiring.
- **Regression guards (HT-CE-2, TE-CE-2) depend on internal detail** — they verify that when `last_engine_type = "pi"` and `conversation_model = "claude/..."`, the *pi* engine (not claude) is asked to compact. This is an implementation detail test. Worth the coupling given BUG A was invisible without it.
