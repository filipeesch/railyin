## MODIFIED Requirements

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
