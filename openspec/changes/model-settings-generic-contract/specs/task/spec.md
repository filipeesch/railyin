## MODIFIED Requirements

### Requirement: Task chat SHALL expose conversation-scoped reasoning-mode control
Task chat SHALL render a generic model-settings selector in the shared conversation input when the selected model exposes a non-empty `settings[]` array. Each axis in `settings[]` is rendered as a selector. The selected `modelParams` values SHALL be persisted at conversation scope and applied to all subsequent task executions.

#### Scenario: Task chat shows control for supported model
- **WHEN** a task conversation uses a model with non-empty `settings[]`
- **THEN** the task chat input renders a model-settings selector for each axis

#### Scenario: Task chat hides control for unsupported model
- **WHEN** a task conversation uses a model with `settings: []`
- **THEN** the task chat input does not render any model-settings selector

#### Scenario: Task chat selection persists to conversation
- **WHEN** the user selects a value in the model-settings selector
- **THEN** the value is saved to `conversations.model_params`
- **AND** later task executions use the persisted `model_params`

#### Scenario: Task RPC response carries modelParams field
- **WHEN** the frontend loads a task
- **THEN** the response includes `modelParams: ModelParamValue[]` (empty array when no override set)
