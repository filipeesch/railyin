## ADDED Requirements

### Requirement: ExecutionParamsEnricher unit tests cover the 4-level resolution chain
The system SHALL have a test file `src/bun/test/execution-params-enricher.test.ts` containing unit tests for `ExecutionParamsEnricher.enrich()` using an in-memory SQLite database seeded via `initDb()`. Tests SHALL directly set `conversations.sampling_preset_override` via `db.run()` and inject a stub `ModelSettingsRepository`.

#### Scenario: EPE-1 — conversation override applied when set
- **WHEN** `conversations.sampling_preset_override` is `"fast"` and `ctx.columnPreset` is `"balanced"`
- **THEN** the returned params have `samplingPresetName === "fast"`

#### Scenario: EPE-2 — column preset used when override is NULL
- **WHEN** `conversations.sampling_preset_override` is `NULL` and `ctx.columnPreset` is `"balanced"`
- **THEN** the returned params have `samplingPresetName === "balanced"`

#### Scenario: EPE-3 — both null yields undefined
- **WHEN** `conversations.sampling_preset_override` is `NULL` and `ctx.columnPreset` is `undefined`
- **THEN** `params.samplingPresetName` is `undefined`

#### Scenario: EPE-4 — unknown override name falls back to column preset
- **WHEN** `conversations.sampling_preset_override` is `"nonexistent"` and `ctx.columnPreset` is `"balanced"`
- **THEN** a warning is logged and `params.samplingPresetName === "balanced"`

#### Scenario: EPE-5 — contextWindowOverride applied from ModelSettingsRepository
- **WHEN** the injected `ModelSettingsRepository` returns `65536` for the workspace+model pair
- **THEN** the returned params have `contextWindowOverride === 65536`

#### Scenario: EPE-6 — base params object is not mutated
- **WHEN** `enrich()` is called with a base params object
- **THEN** the original base object remains unchanged and the returned object is a different reference

#### Scenario: EPE-7 — null conversationId yields no samplingPresetName
- **WHEN** `enrich()` is called with `ctx.conversationId === null` (chat executor edge case)
- **THEN** `params.samplingPresetName` is `undefined` and no DB error is thrown

### Requirement: Executor integration tests verify samplingPresetName flows through enricher
Each executor test file SHALL contain tests asserting that `streamProcessor.lastRun.params.samplingPresetName` is set correctly by `ExecutionParamsEnricher`. Tests use the existing `StubStreamProcessor.lastRun.params` pattern.

#### Scenario: TE-PRESET-3 — TransitionExecutor: conversation override beats column preset
- **WHEN** `conversations.sampling_preset_override` is `"fast"` and the column has `sampling_preset: balanced`
- **THEN** `streamProcessor.lastRun.params.samplingPresetName === "fast"`

#### Scenario: TE-PRESET-5 — column transition does not clear the override
- **WHEN** a task with `sampling_preset_override = "fast"` transitions to a column with `sampling_preset: balanced`
- **THEN** `conversations.sampling_preset_override` is still `"fast"` in the DB after the transition

#### Scenario: HT-PRESET-1 — HumanTurnExecutor: column preset propagates (regression test for bug fix)
- **WHEN** the column has `sampling_preset: precise` and `conversations.sampling_preset_override` is `NULL`
- **THEN** `streamProcessor.lastRun.params.samplingPresetName === "precise"`

#### Scenario: HT-PRESET-2 — HumanTurnExecutor: conversation override wins
- **WHEN** `conversations.sampling_preset_override` is `"fast"` and the column has `sampling_preset: precise`
- **THEN** `streamProcessor.lastRun.params.samplingPresetName === "fast"`

#### Scenario: RE-PRESET-1 — RetryExecutor: column preset propagates (regression test for bug fix)
- **WHEN** the column has `sampling_preset: balanced` and `conversations.sampling_preset_override` is `NULL`
- **THEN** `streamProcessor.lastRun.params.samplingPresetName === "balanced"`

#### Scenario: CE-PRESET-1 — ChatExecutor: conversation override applied
- **WHEN** `conversations.sampling_preset_override` is `"creative"` and no column preset applies
- **THEN** `streamProcessor.lastRun.params.samplingPresetName === "creative"`

### Requirement: conversations.setSamplingPreset handler tests
The test suite SHALL cover the `conversations.setSamplingPreset` RPC handler with in-memory DB tests following the existing `handlers.test.ts` pattern.

#### Scenario: CSP-1 — setSamplingPreset stores a named preset
- **WHEN** `conversations.setSamplingPreset({ conversationId, preset: "fast" })` is called
- **THEN** `SELECT sampling_preset_override FROM conversations WHERE id = conversationId` returns `"fast"`

#### Scenario: CSP-2 — setSamplingPreset clears the override
- **WHEN** `conversations.setSamplingPreset({ conversationId, preset: null })` is called after a preset was set
- **THEN** `sampling_preset_override` is `NULL` in the DB

#### Scenario: CSP-3 — setSamplingPreset with unknown conversationId throws
- **WHEN** `conversations.setSamplingPreset({ conversationId: 99999, preset: "fast" })` is called and no conversation exists
- **THEN** an error is thrown

### Requirement: ModelInfo.availablePresets tests in model-handlers.test.ts
The model handlers test file SHALL verify that Pi engine models include `availablePresets` and non-Pi models do not.

#### Scenario: MH-PRESETS-1 — Pi model returns availablePresets array
- **WHEN** `models.listEnabled` is called with a Pi model in the enabled set, and the engine config has `sampling_presets`
- **THEN** that model's `ModelInfo.availablePresets` contains one entry per named preset with `name` and `params` fields

#### Scenario: MH-PRESETS-2 — Non-Pi model has no availablePresets
- **WHEN** `models.listEnabled` is called and returns a Copilot model
- **THEN** that model's `ModelInfo.availablePresets` is `undefined`

#### Scenario: MH-PRESETS-3 — Pi model with no sampling_presets returns empty array
- **WHEN** `models.listEnabled` returns a Pi model whose engine config has no `sampling_presets`
- **THEN** `availablePresets` is an empty array

### Requirement: DB migration 047 verified in db-migrations.test.ts
The migrations test SHALL verify that migration `047_conversation_sampling_preset` adds the `sampling_preset_override` column to the `conversations` table.

#### Scenario: MIGR-047 — column exists after migrations run
- **WHEN** `runMigrations()` runs against a fresh database
- **THEN** `PRAGMA table_info(conversations)` includes a column named `sampling_preset_override`

### Requirement: helpers.ts initDb() includes sampling_preset_override column
The `conversations` CREATE TABLE statement in `helpers.ts:initDb()` SHALL include `sampling_preset_override TEXT NULL` so all executor integration tests can directly set the override without running real migrations.

#### Scenario: helpers DDL parity
- **WHEN** `initDb()` is called and `db.run("UPDATE conversations SET sampling_preset_override = 'fast' WHERE id = 1")` is executed
- **THEN** no SQLite error is thrown (column exists in test schema)

### Requirement: Playwright sampling-preset.spec.ts covers selector rendering and persistence
A new Playwright spec `e2e/ui/sampling-preset.spec.ts` SHALL test the preset selector UI using mocked API responses. The spec SHALL use `api.returns("models.listEnabled", ...)` with a Pi model fixture containing `availablePresets`, and `api.handle("conversations.setSamplingPreset", ...)` to capture calls.

#### Scenario: SP-A-1 — preset selector visible for Pi model
- **WHEN** the task drawer opens with a Pi model selected and `availablePresets` is non-empty
- **THEN** a preset selector element is visible in the model row

#### Scenario: SP-A-2 — preset selector hidden for non-Pi model
- **WHEN** the task drawer opens with a Copilot model selected
- **THEN** no preset selector element is present in the model row

#### Scenario: SP-A-4 — Auto shown when override is null
- **WHEN** the task or session opens with `samplingPresetOverride: null`
- **THEN** the selector displays "Auto" as the current value

#### Scenario: SP-B-2 — open dropdown shows parameter details
- **WHEN** the preset selector is opened
- **THEN** each non-Auto option shows a parameter detail line (e.g. containing `temp=` or `temperature=`)

#### Scenario: SP-C-1 — selecting a preset calls conversations.setSamplingPreset
- **WHEN** the user clicks a named preset in the selector dropdown
- **THEN** `conversations.setSamplingPreset` is called with the correct `conversationId` and preset name

#### Scenario: SP-C-2 — selecting Auto clears the override
- **WHEN** the user selects "Auto" from the dropdown
- **THEN** `conversations.setSamplingPreset` is called with `preset: null`

#### Scenario: SP-C-3 — reopen shows persisted selection
- **WHEN** the user selects a preset, closes the drawer, and reopens it (with mocked API returning the updated session/task)
- **THEN** the selector displays the previously chosen preset name
