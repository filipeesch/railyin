## ADDED Requirements

### Requirement: Model switch SHALL enforce compatibility and default persistence for conversation settings
When the selected model changes, the system SHALL evaluate existing conversation-scoped model-setting values against the new model's discovered capabilities. Compatible values SHALL be retained. Incompatible values SHALL be cleared. If no explicit user value exists and the new model exposes a default setting, that default SHALL be persisted to the conversation column.

#### Scenario: Compatible value is retained
- **WHEN** a conversation has setting value `medium` and the user switches to a model that supports `medium`
- **THEN** the conversation setting remains `medium`

#### Scenario: Incompatible value is cleared and control hidden
- **WHEN** a conversation has setting value `high` and the user switches to a model with no v1 setting support
- **THEN** the conversation setting is cleared
- **AND** the model-setting control is hidden

#### Scenario: Default is persisted on switch when no explicit value
- **WHEN** the user switches models and the conversation has no explicit setting value
- **AND** the selected model metadata exposes a default value
- **THEN** that default is persisted in the conversation column

### Requirement: Strict discovery only SHALL be used for model-setting capability
The system SHALL derive model-setting capability/options/defaults exclusively from provider/SDK discovery metadata. Static hardcoded model-name compatibility mappings SHALL NOT be used.

#### Scenario: Discovery metadata absent yields no capability
- **WHEN** provider discovery returns no model-setting metadata for a model
- **THEN** the model is treated as unsupported for v1 setting control
- **AND** no inferred capability is added from static mappings
