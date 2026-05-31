## 1. Test Infrastructure

- [ ] 1.1 Add `sampling_preset_override TEXT NULL` to the `conversations` CREATE TABLE in `src/bun/test/helpers.ts:initDb()` (DDL parity with migration 047)

## 2. Unit Tests — ExecutionParamsEnricher

- [ ] 2.1 Create `src/bun/test/execution-params-enricher.test.ts`
- [ ] 2.2 Add **EPE-1**: conversation override (`"fast"`) beats column preset (`"balanced"`) → `samplingPresetName === "fast"`
- [ ] 2.3 Add **EPE-2**: `sampling_preset_override NULL` + `columnPreset "balanced"` → `samplingPresetName === "balanced"`
- [ ] 2.4 Add **EPE-3**: both null → `params.samplingPresetName === undefined`
- [ ] 2.5 Add **EPE-5**: injected `ModelSettingsRepository` returning `65536` → `params.contextWindowOverride === 65536`
- [ ] 2.6 Add **EPE-6**: base params object is not mutated after `enrich()`
- [ ] 2.7 Add **EPE-7**: `ctx.conversationId === null` → no DB error, `samplingPresetName` is `undefined`

## 3. Integration Tests — TransitionExecutor

- [ ] 3.1 Add **TE-PRESET-3** to `transition-executor.test.ts`: conversation override beats column preset (`samplingPresetName === "fast"`)
- [ ] 3.2 Add **TE-PRESET-5** to `transition-executor.test.ts`: column transition does NOT clear `conversations.sampling_preset_override`

## 4. Integration Tests — HumanTurnExecutor (bug-fix regression)

- [ ] 4.1 Add **HT-PRESET-1** to `human-turn-executor.test.ts`: column preset propagates when override is NULL (regression proof)
- [ ] 4.2 Add **HT-PRESET-2** to `human-turn-executor.test.ts`: conversation override wins over column preset

## 5. Integration Tests — RetryExecutor (bug-fix regression)

- [ ] 5.1 Add **RE-PRESET-1** to `retry-executor.test.ts`: column preset propagates when override is NULL (regression proof)

## 6. Integration Tests — ChatExecutor

- [ ] 6.1 Add **CE-PRESET-1** to `chat-executor.test.ts`: conversation override applied in session context

## 7. Integration Tests — Handlers

- [ ] 7.1 Add **CSP-1** to `handlers.test.ts`: `conversations.setSamplingPreset` stores a named preset in DB
- [ ] 7.2 Add **CSP-2** to `handlers.test.ts`: `conversations.setSamplingPreset({ preset: null })` clears the override
- [ ] 7.3 Add **CSP-3** to `handlers.test.ts`: `conversations.setSamplingPreset` with unknown `conversationId` throws

## 8. Integration Tests — Model Handlers

- [ ] 8.1 Add **MH-PRESETS-1** to `model-handlers.test.ts`: Pi model returns `availablePresets` with `name`+`params` per entry
- [ ] 8.2 Add **MH-PRESETS-2** to `model-handlers.test.ts`: non-Pi model has `availablePresets === undefined`
- [ ] 8.3 Add **MH-PRESETS-3** to `model-handlers.test.ts`: Pi model with no `sampling_presets` → `availablePresets === []`

## 9. Migration Tests

- [ ] 9.1 Add **MIGR-047** to `db-migrations.test.ts`: after `runMigrations()`, `PRAGMA table_info(conversations)` contains `sampling_preset_override`

## 10. Frontend Fixtures

- [ ] 10.1 Add `samplingPresetOverride: string | null` field to `makeTask()` in `e2e/ui/fixtures/mock-data.ts`
- [ ] 10.2 Add `samplingPresetOverride: string | null` field to `makeChatSession()` in `e2e/ui/fixtures/mock-data.ts`
- [ ] 10.3 Add `availablePresets` and `engineId: "pi"` to the Pi model fixture in `mock-data.ts`

## 11. Playwright — Sampling Preset UI

- [ ] 11.1 Create `e2e/ui/sampling-preset.spec.ts` with test scaffolding (beforeEach mock setup)
- [ ] 11.2 Add **SP-A-1**: preset selector visible when Pi model active with `availablePresets`
- [ ] 11.3 Add **SP-A-2**: preset selector hidden for non-Pi model
- [ ] 11.4 Add **SP-A-4**: selector shows "Auto" when `samplingPresetOverride` is `null`
- [ ] 11.5 Add **SP-B-2**: open dropdown shows parameter detail row per option
- [ ] 11.6 Add **SP-C-1**: selecting a named preset calls `conversations.setSamplingPreset` with correct args
- [ ] 11.7 Add **SP-C-2**: selecting "Auto" calls `conversations.setSamplingPreset({ preset: null })`
- [ ] 11.8 Add **SP-C-3**: reopen drawer after selection shows the persisted preset name
