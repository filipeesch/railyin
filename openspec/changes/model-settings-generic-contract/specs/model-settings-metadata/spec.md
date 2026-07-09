## MODIFIED Requirements

### Requirement: Models list enabled SHALL expose normalized setting metadata and raw provider metadata
The system SHALL extend `models.listEnabled` to include model-setting metadata that is usable directly by chat UI and traceable to provider discovery output. The response SHALL include a normalized `settings: ModelSettingAxis[]` array (one entry per configurable parameter axis) and the raw provider metadata payload. An empty `settings` array indicates no configurable settings for that model.

#### Scenario: Supported model returns normalized settings axes and raw metadata
- **WHEN** `models.listEnabled` includes a model that supports configurable settings
- **THEN** that model entry includes `settings: ModelSettingAxis[]` with at least one axis containing `id`, `label`, `options[]`, and `defaultValue`
- **AND** that model entry includes raw provider metadata used to derive those axes

#### Scenario: Unsupported model returns empty settings array
- **WHEN** `models.listEnabled` includes a model with no discovered setting capability
- **THEN** that model entry includes `settings: []`
- **AND** UI control visibility is false (selector hidden) for that model

## REMOVED Requirements

### Requirement: Normalized metadata SHALL preserve provider-native option labels
**Reason**: Requirement merged into new `model-settings-generic-contract` spec — `ModelSettingAxis.options[].label` preserves provider-native labels by construction.
**Migration**: See `model-settings-generic-contract/spec.md` — `ModelSettingAxis` carries both `value` and `label` per option, preserving SDK-native display strings.
