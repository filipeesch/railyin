## ADDED Requirements

### Requirement: Models list enabled SHALL expose normalized setting metadata and raw provider metadata
The system SHALL extend `models.listEnabled` to include model-setting metadata that is usable directly by chat UI and traceable to provider discovery output. The response SHALL include a normalized v1 setting contract (supported values, default value, visibility/compatibility state) and raw provider metadata payload.

#### Scenario: Supported model returns normalized and raw metadata
- **WHEN** `models.listEnabled` includes a model that supports v1 settings
- **THEN** that model entry includes normalized setting metadata with supported values and default value
- **AND** that model entry includes raw provider metadata used to derive those values

#### Scenario: Unsupported model returns hidden metadata state
- **WHEN** `models.listEnabled` includes a model with no discovered v1 setting capability
- **THEN** that model entry reports an empty supported-values list
- **AND** UI control visibility is false for that model

### Requirement: Normalized metadata SHALL preserve provider-native option labels
The normalized model-setting metadata SHALL preserve provider-native option labels/values for rendering and persistence, even when the UI control label is generic.

#### Scenario: Cursor mode labels are preserved
- **WHEN** Cursor discovery returns variant/parameter options such as `Fast` and `Normal`
- **THEN** normalized metadata contains those provider-native options unchanged
- **AND** the generic UI setting label does not alter stored provider option values
