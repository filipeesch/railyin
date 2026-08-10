## MODIFIED Requirements

### Requirement: listModels() from per-model config
The Pi engine's `listModels()` SHALL return `EngineModelInfo.settings: ModelSettingAxis[]` synthesized from the model's per-model config (Mode/Sampling/Reasoning axes) and `availablePresets` built from the model's `sampling_presets` instead of engine-level presets.

#### Scenario: listModels exposes axes and per-model presets
- **WHEN** `listModels()` returns a Pi model with `sampling_presets: { balanced, precise }` and a Mode variant axis
- **THEN** `settings` contains the Mode/Sampling axes and `availablePresets` contains `balanced` and `precise` only

### Requirement: Sampling preset applied per active model
PiEngine's sampling preset resolution SHALL use the active model's `sampling_presets` and `default_sampling_preset`, falling back to engine default then send-nothing, instead of the removed engine-level `sampling_presets`.

#### Scenario: onPayload uses the active model preset set
- **WHEN** `createManagedExecution()` resolves a sampling preset for a conversation whose model has `sampling_presets: { balanced, precise }`
- **THEN** `onPayload` merges only defined fields from the matched preset, and an unknown override name logs a warning and applies `default_sampling_preset`

### Requirement: execute() applies axis values and base options
`execute()` SHALL resolve each axis's active value (`params.modelParams` override wins over config default), deep-merge the model's static `options` as the base request body, and set `session.agent.state.thinkingLevel` from the Mode/Reasoning axis plus the provider-specific payload knob (`reasoning_effort`, `enable_thinking`, `chat_template_kwargs`).

#### Scenario: Axis override wins over config default
- **WHEN** a conversation sets `modelParams: [{id: "mode", value: "max"}]` while the model's default variant is `normal`
- **THEN** the request body uses the `max` variant's `options`

#### Scenario: Static options form the base body
- **WHEN** a model config has `options: { reasoning_effort: high }` and no axis override
- **THEN** the merged request body contains `reasoning_effort: high` plus default sampling params

### Requirement: Child sessions inherit parent thinking level
The child (delegate) session factory SHALL set `session.agent.state.thinkingLevel` to the parent session's resolved level instead of the previous hardcoded `"off"`.

#### Scenario: Delegate child inherits high level
- **WHEN** a child session is created from a parent whose resolved thinking level is `high`
- **THEN** the child's `thinkingLevel` is `high`
