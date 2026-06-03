## Purpose
Defines the sampling parameter preset system for the Pi engine — how presets are declared in `engines.yaml`, referenced by workflow columns, and resolved at execution time.
## Requirements
### Requirement: Sampling preset definition in engines.yaml
The Pi engine config in `engines.yaml` SHALL support an optional `sampling_presets` map where keys are preset names (stable identifiers used in column config and the DB) and values are objects containing any combination of `label` (string), `description` (string), `temperature` (number), `top_p` (number), `top_k` (number), `presence_penalty` (number), `repetition_penalty` (number), `frequency_penalty` (number), `seed` (number), and `min_p` (number). `label` is the human-readable display name shown in the UI selector; if omitted, the YAML key is used as the label. `description` is optional explanatory text shown as a subtitle in the selector dropdown. Numeric sampling fields are optional — omitted fields are not sent to the LLM API. The Pi engine config SHALL also support an optional `default_sampling_preset` string that names which preset to apply when a column specifies none. All preset fields are optional — omitted fields are not sent to the LLM API.

#### Scenario: Pi engine config with sampling_presets is parsed
- **WHEN** `engines.yaml` contains a Pi engine entry with `sampling_presets` and `default_sampling_preset`
- **THEN** `PiEngineConfig.sampling_presets` is a map of preset name to `SamplingPreset` objects and `default_sampling_preset` holds the fallback preset name

#### Scenario: Pi engine config without sampling_presets is valid
- **WHEN** `engines.yaml` contains a Pi engine entry with no `sampling_presets` field
- **THEN** the engine loads successfully with `sampling_presets` defaulting to an empty map and `default_sampling_preset` defaulting to `undefined`

#### Scenario: Pi engine preset with label and description
- **WHEN** a preset entry contains `label: "Creative / Design"` and `description: "High temp for brainstorming"`
- **THEN** `SamplingPreset.label` is `"Creative / Design"` and `SamplingPreset.description` is `"High temp for brainstorming"`

#### Scenario: Pi engine preset without label falls back to key
- **WHEN** a preset entry has no `label` field
- **THEN** `SamplingPreset.label` is `undefined` and the UI falls back to displaying the YAML key as the name

#### Scenario: Pi engine preset with repetition_penalty is parsed
- **WHEN** a preset entry contains `repetition_penalty: 1.1`
- **THEN** `SamplingPreset.repetition_penalty` is `1.1`

#### Scenario: Pi engine preset with frequency_penalty is parsed
- **WHEN** a preset entry contains `frequency_penalty: 0.2`
- **THEN** `SamplingPreset.frequency_penalty` is `0.2`

#### Scenario: Pi engine preset with seed is parsed
- **WHEN** a preset entry contains `seed: 42`
- **THEN** `SamplingPreset.seed` is `42`

#### Scenario: Pi engine preset with min_p is parsed
- **WHEN** a preset entry contains `min_p: 0.05`
- **THEN** `SamplingPreset.min_p` is `0.05`

### Requirement: Workflow column references a sampling preset by name
A workflow column config SHALL support an optional `sampling_preset` string field that references a preset name defined in the Pi engine's `sampling_presets` map.

#### Scenario: Column with sampling_preset is parsed
- **WHEN** a workflow column YAML entry includes `sampling_preset: precise`
- **THEN** `WorkflowColumnConfig.sampling_preset` equals `"precise"`

#### Scenario: Column without sampling_preset defaults to undefined
- **WHEN** a workflow column YAML entry has no `sampling_preset` field
- **THEN** `WorkflowColumnConfig.sampling_preset` is `undefined`

### Requirement: Preset resolution fallback chain
The system SHALL resolve the effective sampling preset for an execution using the following fallback chain: (1) the preset name stored in `conversations.sampling_preset_override` for the current conversation; (2) the preset named by the column's `sampling_preset` field; (3) the preset named by the engine's `default_sampling_preset` field; (4) no sampling override. If a preset name is specified at any level but not found in `sampling_presets`, the system SHALL log a warning and fall through to the next fallback level.

#### Scenario: Conversation override takes priority over column preset
- **WHEN** `conversations.sampling_preset_override` is `"fast"` and the column has `sampling_preset: creative`
- **THEN** the `fast` preset values are applied to the execution

#### Scenario: Conversation override takes priority over engine default
- **WHEN** `conversations.sampling_preset_override` is `"fast"` and the engine has `default_sampling_preset: balanced`
- **THEN** the `fast` preset values are applied to the execution

#### Scenario: Column preset used when conversation override is null
- **WHEN** `conversations.sampling_preset_override` is NULL and the column has `sampling_preset: creative` and the engine has `default_sampling_preset: balanced`
- **THEN** the `creative` preset values are applied to the execution

#### Scenario: Engine default used when column has no preset and no conversation override
- **WHEN** `conversations.sampling_preset_override` is NULL, the column has no `sampling_preset`, and the engine has `default_sampling_preset: balanced`
- **THEN** the `balanced` preset values are applied to the execution

#### Scenario: No override when no level specifies a preset
- **WHEN** `conversations.sampling_preset_override` is NULL, the column has no `sampling_preset`, and the engine has no `default_sampling_preset`
- **THEN** no sampling parameters are injected and the LLM API uses provider defaults

#### Scenario: Unknown conversation preset falls back gracefully
- **WHEN** `conversations.sampling_preset_override` is `"nonexistent"` and the engine has `default_sampling_preset: balanced`
- **THEN** a warning is logged, the conversation override level is skipped, and the `balanced` preset is applied

### Requirement: resolveSamplingPreset pure function
The system SHALL provide a pure function `resolveSamplingPreset(presetName, config)` in `src/bun/engine/pi/sampling-params.ts` that accepts an optional preset name string and a `PiEngineConfig`, and returns a `SamplingParams` object or `undefined`. The `SamplingParams` type SHALL contain only LLM-facing numeric fields (`temperature`, `top_p`, `top_k`, `presence_penalty`, `repetition_penalty`, `frequency_penalty`, `seed`, `min_p`) — it SHALL NOT include `label` or `description`. Only defined (non-`undefined`) fields of the resolved preset SHALL be included in the returned object. The filtering SHALL use an explicit `SAMPLING_KEYS` allowlist to guarantee UI-only metadata fields are never forwarded to the LLM API payload.

#### Scenario: Returns preset values for known name
- **WHEN** `resolveSamplingPreset("creative", config)` is called and `config.sampling_presets.creative` exists
- **THEN** returns a `SamplingParams` object for `creative` with only defined numeric fields

#### Scenario: Returns undefined for no preset name and no default
- **WHEN** `resolveSamplingPreset(undefined, config)` is called and `config.default_sampling_preset` is undefined
- **THEN** returns `undefined`

#### Scenario: label and description are not included in resolved params
- **WHEN** a preset has `label: "Balanced"`, `description: "Good default"`, and `temperature: 0.8` defined
- **THEN** the resolved `SamplingParams` contains `temperature: 0.8` but NOT `label` or `description`

#### Scenario: repetition_penalty forwarded in resolved params
- **WHEN** a preset has `repetition_penalty: 1.1` defined
- **THEN** the resolved `SamplingParams` contains `repetition_penalty: 1.1`

#### Scenario: frequency_penalty forwarded in resolved params
- **WHEN** a preset has `frequency_penalty: 0.3` defined
- **THEN** the resolved `SamplingParams` contains `frequency_penalty: 0.3`

#### Scenario: seed forwarded in resolved params
- **WHEN** a preset has `seed: 42` defined
- **THEN** the resolved `SamplingParams` contains `seed: 42`

#### Scenario: min_p forwarded in resolved params
- **WHEN** a preset has `min_p: 0.05` defined
- **THEN** the resolved `SamplingParams` contains `min_p: 0.05`

