## Purpose
Defines the test coverage requirements for the Pi engine sampling parameter preset feature, covering unit tests for the resolver, engine integration, execution pipeline, and config parsing.

## Requirements

### Requirement: resolveSamplingPreset pure unit tests
The test suite SHALL cover `resolveSamplingPreset()` with at minimum ten cases verifying: known preset returned, partial presets (only defined fields), all four params, undefined returned when no preset and no default, fallback to engine default, column preset priority over default, unknown preset name falls back gracefully with a warning logged, missing `sampling_presets` map is safe, and `temperature: 0` is NOT filtered (strict `!== undefined` semantics).

#### Scenario: PS-1 — known preset name returns exact preset object
- **WHEN** `resolveSamplingPreset("precise", config)` is called and `config.sampling_presets.precise = { temperature: 0.2, top_p: 0.85 }`
- **THEN** returns `{ temperature: 0.2, top_p: 0.85 }`

#### Scenario: PS-2 — partial preset strips undefined fields
- **WHEN** a preset defines only `temperature: 0.8` (omitting `top_p`, `top_k`, `presence_penalty`)
- **THEN** the returned object contains only `{ temperature: 0.8 }` with no `undefined` keys

#### Scenario: PS-3 — all four params returned when all defined
- **WHEN** a preset defines all four fields
- **THEN** all four are present in the returned object

#### Scenario: PS-4 — returns undefined when no name and no engine default
- **WHEN** `resolveSamplingPreset(undefined, config)` and `config.default_sampling_preset` is `undefined`
- **THEN** returns `undefined`

#### Scenario: PS-5 — falls back to engine default when name is undefined
- **WHEN** `resolveSamplingPreset(undefined, config)` and `config.default_sampling_preset = "balanced"`
- **THEN** returns the `balanced` preset values

#### Scenario: PS-6 — explicit name takes priority over engine default
- **WHEN** `resolveSamplingPreset("creative", config)` and `config.default_sampling_preset = "balanced"`
- **THEN** returns the `creative` preset, not `balanced`

#### Scenario: PS-7 — unknown preset name falls back to engine default
- **WHEN** `resolveSamplingPreset("nonexistent", config)` and `config.default_sampling_preset = "balanced"`
- **THEN** returns the `balanced` preset values (warning logged, not thrown)

#### Scenario: PS-8 — unknown preset and no default returns undefined
- **WHEN** `resolveSamplingPreset("nonexistent", config)` and `config.default_sampling_preset` is `undefined`
- **THEN** returns `undefined`

#### Scenario: PS-9 — missing sampling_presets map is safe
- **WHEN** `config.sampling_presets` is `undefined` or `{}`
- **THEN** `resolveSamplingPreset("any", config)` returns `undefined` without throwing

#### Scenario: PS-10 — temperature: 0 is preserved (falsy safety)
- **WHEN** a preset defines `temperature: 0`
- **THEN** the returned object includes `temperature: 0` (not filtered as falsy)

### Requirement: PiEngine _applyPresetToSession unit tests
The test suite SHALL extend `MockAgentSession.agent` with an optional `onPayload` field and add a `PE-PRESET-*` describe block in `pi-engine.test.ts` that calls `(engine as any)._applyPresetToSession(session, presetName)` directly.

#### Scenario: PE-PRESET-1 — resolved preset sets onPayload to a function
- **WHEN** `_applyPresetToSession(session, "creative")` is called and the engine config has a `creative` preset
- **THEN** `session.agent.onPayload` is a function (not `undefined`)

#### Scenario: PE-PRESET-2 — onPayload function merges only defined preset fields
- **WHEN** the resolved preset is `{ temperature: 1.2, top_p: 0.98 }` and `session.agent.onPayload({ model: "x" }, null)` is called
- **THEN** the return value contains `temperature: 1.2`, `top_p: 0.98`, and `model: "x"`; no `top_k` or `presence_penalty` keys are present

#### Scenario: PE-PRESET-3 — no preset clears onPayload to undefined
- **WHEN** `_applyPresetToSession(session, undefined)` is called and no engine default exists
- **THEN** `session.agent.onPayload` is `undefined`

#### Scenario: PE-PRESET-4 — second call with different preset updates onPayload
- **WHEN** `_applyPresetToSession(session, "precise")` is called after `_applyPresetToSession(session, "creative")`
- **THEN** `session.agent.onPayload` reflects the `precise` preset, not `creative`

#### Scenario: PE-PRESET-5 — session reuse leakage prevention
- **WHEN** `_applyPresetToSession(session, "balanced")` is called then `_applyPresetToSession(session, undefined)` with no engine default
- **THEN** `session.agent.onPayload` is `undefined` (prior preset does not leak)

### Requirement: TransitionExecutor samplingPresetName integration tests
The test suite SHALL add `TE-PRESET-*` cases in `transition-executor.test.ts` using a workflow YAML that includes a column with `sampling_preset: balanced` and verifying `ExecutionParams.samplingPresetName` via `CapturingParamsBuilder`.

#### Scenario: TE-PRESET-1 — column with sampling_preset populates samplingPresetName
- **WHEN** the column config has `sampling_preset: balanced` and a transition triggers execution
- **THEN** `ExecutionParams.samplingPresetName` equals `"balanced"`

#### Scenario: TE-PRESET-2 — column without sampling_preset leaves samplingPresetName undefined
- **WHEN** the column config has no `sampling_preset` field
- **THEN** `ExecutionParams.samplingPresetName` is `undefined`

### Requirement: ExecutionParamsBuilder field passthrough tests
The test suite SHALL add `EPB-PRESET-*` cases confirming `samplingPresetName` passes through `build()` unchanged.

#### Scenario: EPB-PRESET-1 — samplingPresetName passes through build()
- **WHEN** `builder.build(...)` is called with a task and the params include `samplingPresetName: "balanced"` (injected by extending the builder call)
- **THEN** `params.samplingPresetName` equals `"balanced"`

#### Scenario: EPB-PRESET-2 — samplingPresetName absent leaves field undefined
- **WHEN** `builder.build(...)` is called without setting `samplingPresetName`
- **THEN** `params.samplingPresetName` is `undefined`

### Requirement: Config YAML parsing tests for sampling fields
The test suite SHALL add `CC-PRESET-*` cases in `column-config.test.ts` verifying that `sampling_preset` on columns and `sampling_presets` on engine config parse correctly via `setupTestConfig` with appropriate YAML.

#### Scenario: CC-PRESET-1 — column YAML with sampling_preset parses correctly
- **WHEN** a workflow YAML column entry includes `sampling_preset: precise`
- **THEN** `getColumnConfig()` returns a column where `sampling_preset === "precise"`

#### Scenario: CC-PRESET-2 — column YAML without sampling_preset is undefined
- **WHEN** a workflow YAML column entry has no `sampling_preset` field
- **THEN** `getColumnConfig()` returns a column where `sampling_preset` is `undefined`

#### Scenario: CC-PRESET-3 — engines.yaml with sampling_presets block populates PiEngineConfig
- **WHEN** `engines.yaml` contains a Pi engine with `sampling_presets: { balanced: { temperature: 0.8 } }` and `default_sampling_preset: balanced`
- **THEN** the loaded `PiEngineConfig` has `sampling_presets.balanced.temperature === 0.8` and `default_sampling_preset === "balanced"`

#### Scenario: CC-PRESET-4 — engines.yaml Pi entry without sampling fields loads without error
- **WHEN** `engines.yaml` contains a Pi engine entry with no `sampling_presets` or `default_sampling_preset` fields
- **THEN** config loads successfully and `sampling_presets` is `undefined` or empty
