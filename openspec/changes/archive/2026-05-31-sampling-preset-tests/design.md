## Context

The `sampling-preset-per-conversation` feature adds a 4-level resolution chain (`conversation override → column preset → engine default → none`), introduces `ExecutionParamsEnricher` to centralise param enrichment, fixes missing `samplingPresetName` in `HumanTurnExecutor`/`RetryExecutor`, extends `ModelInfo` with `availablePresets`, adds `conversations.setSamplingPreset`, and adds a Pi-only preset selector to `ConversationInput.vue`. None of these have tests yet.

Existing test patterns to follow:
- **Executor tests**: `CapturingParamsBuilder` + `StubStreamProcessor` pattern — `streamProcessor.lastRun.params` is the assertion target. Already used in `transition-executor.test.ts`, `human-turn-executor.test.ts`, `retry-executor.test.ts`.
- **ChatExecutor tests**: Constructor-injected `ModelSettingsRepository` stub (`NullModelSettingsRepository` or `fixedContextWindowRepo`). `ExecutionParamsEnricher` will follow the same injection pattern.
- **Model handlers**: `mockOrchestratorWithPi` stub in `model-handlers.test.ts` — extend to include `availablePresets` field.
- **Playwright**: `model-persistence.spec.ts` — mock `models.listEnabled` to return Pi models with `availablePresets`, mock `conversations.setSamplingPreset`, assert on dropdown visibility and RPC call capture.

## Goals / Non-Goals

**Goals:**
- Verify the entire resolution chain for `ExecutionParamsEnricher` in isolation.
- Prove the `HumanTurnExecutor`/`RetryExecutor` bug is fixed (they now forward `samplingPresetName`).
- Cover `conversations.setSamplingPreset` handler behaviour.
- Cover `ModelInfo.availablePresets` population from Pi engine config.
- Cover preset selector rendering rules (Pi-only, Auto default, open details) via Playwright.
- Cover persistence round-trip (select → RPC call → reopen shows selection).

**Non-Goals:**
- End-to-end execution with a real Pi API (no network calls in tests).
- Testing `resolveSamplingPreset` beyond existing `pi-sampling-params.test.ts` (the pure function is already well-covered; the enricher owns the chain, not the resolver).

## Decisions

### 1. `resolveSamplingPreset` stays pure; enricher owns the 4-level chain
`ExecutionParamsEnricher.enrich()` reads `conversations.sampling_preset_override`, falls back to `columnPreset`, then calls `resolveSamplingPreset(effectivePresetName, config)` as before. This means no new tests needed in `pi-sampling-params.test.ts` for the chain — enricher tests cover it.

### 2. `helpers.ts:initDb()` inline DDL updated (schema parity)
The inline `CREATE TABLE conversations` in `helpers.ts` must include `sampling_preset_override TEXT NULL` so executor integration tests can set the field directly via `db.run()`. This is standard practice for this codebase — every migration that adds a column to a tested table requires an inline DDL update in `helpers.ts`.

### 3. `ExecutionParamsEnricher` unit tests use in-memory DB
Constructor receives a `Database` (or thin `IConversationRepository` interface). Tests spin up `initDb()`, write `sampling_preset_override` directly, and assert enriched params. No mock framework required — same pattern as `model-settings-repository.test.ts`.

### 4. Playwright mock additions in `mock-data.ts` only
No changes to `mock-api.ts` routing tables needed — `conversations.setSamplingPreset` follows the same registration pattern as `chatSessions.setModel`. Pi model fixture updated with `availablePresets` and `engineId: "pi"` fields.

## Risks / Trade-offs

- **Test ordering dependency**: `sampling-preset-tests` must run after `sampling-preset-per-conversation` is implemented. The test files will fail to compile until the production types/classes exist. This is expected — tests live in the same branch.
- **helpers.ts DDL drift**: A future migration will also need to add the column to the inline DDL. This is an existing known limitation of the test helper pattern (not introduced by this change).
