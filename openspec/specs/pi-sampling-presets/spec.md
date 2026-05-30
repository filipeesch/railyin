## Purpose
Defines the sampling parameter preset system for the Pi engine — how presets are declared in `engines.yaml`, referenced by workflow columns, and resolved at execution time.

## Requirements

### Requirement: Sampling preset definition in engines.yaml
The Pi engine config in `engines.yaml` SHALL support an optional `sampling_presets` map where keys are preset names and values are objects containing any combination of `temperature` (number), `top_p` (number), `top_k` (number), and `presence_penalty` (number). The Pi engine config SHALL also support an optional `default_sampling_preset` string that names which preset to apply when a column specifies none. All preset fields are optional — omitted fields are not sent to the LLM API.

#### Scenario: Pi engine config with sampling_presets is parsed
- **WHEN** `engines.yaml` contains a Pi engine entry with `sampling_presets` and `default_sampling_preset`
- **THEN** `PiEngineConfig.sampling_presets` is a map of preset name to `SamplingPreset` objects and `default_sampling_preset` holds the fallback preset name

#### Scenario: Pi engine config without sampling_presets is valid
- **WHEN** `engines.yaml` contains a Pi engine entry with no `sampling_presets` field
- **THEN** the engine loads successfully with `sampling_presets` defaulting to an empty map and `default_sampling_preset` defaulting to `undefined`

### Requirement: Workflow column references a sampling preset by name
A workflow column config SHALL support an optional `sampling_preset` string field that references a preset name defined in the Pi engine's `sampling_presets` map.

#### Scenario: Column with sampling_preset is parsed
- **WHEN** a workflow column YAML entry includes `sampling_preset: precise`
- **THEN** `WorkflowColumnConfig.sampling_preset` equals `"precise"`

#### Scenario: Column without sampling_preset defaults to undefined
- **WHEN** a workflow column YAML entry has no `sampling_preset` field
- **THEN** `WorkflowColumnConfig.sampling_preset` is `undefined`

### Requirement: Preset resolution fallback chain
The system SHALL resolve the effective sampling preset for an execution using the following fallback chain: (1) the preset named by the column's `sampling_preset` field; (2) the preset named by the engine's `default_sampling_preset` field; (3) no sampling override. If a preset name is specified but not found in `sampling_presets`, the system SHALL log a warning and fall through to the next fallback level.

#### Scenario: Column preset takes priority
- **WHEN** a column has `sampling_preset: creative` and the engine has `default_sampling_preset: balanced`
- **THEN** the `creative` preset values are applied to the execution

#### Scenario: Engine default used when column has no preset
- **WHEN** a column has no `sampling_preset` and the engine has `default_sampling_preset: balanced`
- **THEN** the `balanced` preset values are applied to the execution

#### Scenario: No override when neither column nor engine specifies a preset
- **WHEN** a column has no `sampling_preset` and the engine has no `default_sampling_preset`
- **THEN** no sampling parameters are injected and the LLM API uses provider defaults

#### Scenario: Unknown preset name falls back gracefully
- **WHEN** a column references `sampling_preset: nonexistent` and the engine has `default_sampling_preset: balanced`
- **THEN** a warning is logged and the `balanced` preset is applied instead

### Requirement: resolveSamplingPreset pure function
The system SHALL provide a pure function `resolveSamplingPreset(presetName, config)` in `src/bun/engine/pi/sampling-params.ts` that accepts an optional preset name string and a `PiEngineConfig`, and returns the resolved `SamplingPreset` object or `undefined`. Only defined (non-`undefined`) fields of the resolved preset SHALL be included in the returned object.

#### Scenario: Returns preset values for known name
- **WHEN** `resolveSamplingPreset("creative", config)` is called and `config.sampling_presets.creative` exists
- **THEN** returns the `SamplingPreset` object for `creative` with only defined fields

#### Scenario: Returns undefined for no preset name and no default
- **WHEN** `resolveSamplingPreset(undefined, config)` is called and `config.default_sampling_preset` is undefined
- **THEN** returns `undefined`
