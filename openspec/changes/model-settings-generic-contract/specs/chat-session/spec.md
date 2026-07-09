## MODIFIED Requirements

### Requirement: Session chat SHALL expose conversation-scoped reasoning-mode control
Standalone session chat SHALL render a generic model-settings selector driven by `settings[]` from `models.listEnabled`, identical in behavior to task chat. The selected `modelParams` values are persisted on the session's conversation.

#### Scenario: Session chat shows selector for supported model
- **WHEN** a chat session conversation uses a model with non-empty `settings[]`
- **THEN** session chat renders a model-settings selector

#### Scenario: Session chat hides selector for unsupported model
- **WHEN** a chat session conversation uses a model with `settings: []`
- **THEN** session chat hides the model-settings selector

### Requirement: Session chat selection SHALL persist and survive model switches
Session chat SHALL persist selected `modelParams` on the conversation and apply model-switch compatibility/default rules identically to task chat.

#### Scenario: Session chat retains compatible param after model switch
- **WHEN** the user switches to a session model that still supports the current `model_params` entries
- **THEN** the session conversation keeps the compatible entries unchanged

#### Scenario: Session chat clears incompatible param and applies discovered default
- **WHEN** the user switches to a session model where the current `model_params` entries are incompatible
- **THEN** incompatible entries are removed
- **AND** if the new model exposes a default for a setting axis and no explicit override exists, that default is persisted

#### Scenario: Session RPC response carries modelParams field
- **WHEN** the frontend loads a chat session
- **THEN** the response includes `modelParams: ModelParamValue[]` (empty array when no override set)
