## MODIFIED Requirements

### Requirement: Model switch SHALL enforce compatibility and default persistence for conversation settings
When the selected model changes, the system SHALL evaluate existing conversation-scoped `model_params` entries against the new model's `settings[]` axes. Params with axis ids present in the new model's `settings[]` and compatible values SHALL be retained. Params with no matching axis or incompatible values SHALL be removed. If no explicit user value exists for a given axis and the new model exposes a default value for that axis, that default SHALL be persisted to `model_params`.

#### Scenario: Compatible param is retained
- **WHEN** a conversation has `model_params = [{"id":"effort","value":"medium"}]` and the user switches to a model that supports effort with "medium" as a valid value
- **THEN** `model_params` remains `[{"id":"effort","value":"medium"}]`

#### Scenario: Incompatible param is cleared and control hidden
- **WHEN** a conversation has `model_params = [{"id":"effort","value":"high"}]` and the user switches to a model with no v1 setting support (`settings: []`)
- **THEN** `model_params` is cleared to `[]`
- **AND** the model-setting control is hidden

#### Scenario: Default is persisted on switch when no explicit value
- **WHEN** the user switches models and the conversation has no entry in `model_params` for a given axis
- **AND** the new model's `settings[]` includes that axis with a non-null `defaultValue`
- **THEN** that default is stored as `[{"id":"<axisId>","value":"<defaultValue>"}]` in `model_params`
