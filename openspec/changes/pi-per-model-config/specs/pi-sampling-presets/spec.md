## MODIFIED Requirements

### Requirement: Sampling presets are per-model
Sampling presets SHALL be declared on each model (`sampling_presets` + `default_sampling_preset`) rather than at engine level. Engine-level `sampling_presets`/`default_sampling_preset` SHALL be removed from `PiEngineConfig`.

#### Scenario: Presets live on the model
- **WHEN** a Pi model config has `sampling_presets: { balanced, precise }`
- **THEN** presets are resolved from that model, and no engine-level preset field exists

#### Scenario: Unknown preset name falls back to model default
- **WHEN** a conversation's `sampling_preset_override` names a preset absent from the active model
- **THEN** a warning is logged and the model's `default_sampling_preset` is applied

### Requirement: Default preset resolution order
Resolving a sampling preset for an execution SHALL use the active model's `sampling_presets` and `default_sampling_preset`, falling back to provider/engine default then send-nothing.

#### Scenario: Model default is applied when no override
- **WHEN** an execution has no `sampling_preset_override`
- **THEN** the model's `default_sampling_preset` is used when defined, else provider default
