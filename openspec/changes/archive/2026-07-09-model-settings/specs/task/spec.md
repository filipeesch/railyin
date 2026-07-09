## ADDED Requirements

### Requirement: Task chat SHALL expose conversation-scoped reasoning-mode control
Task chat SHALL render the v1 model-setting control in the shared conversation input when the selected model supports it. The selected value SHALL be persisted at conversation scope and reused by subsequent task executions.

#### Scenario: Task chat shows control for supported model
- **WHEN** a task conversation uses a model with non-empty supported setting values
- **THEN** the task chat input renders the reasoning-mode selector

#### Scenario: Task chat hides control for unsupported model
- **WHEN** a task conversation uses a model with no supported setting values
- **THEN** the task chat input does not render the reasoning-mode selector

#### Scenario: Task chat selection persists to conversation
- **WHEN** the user selects a reasoning-mode value in task chat
- **THEN** the value is saved on the task conversation
- **AND** later task sends use the persisted conversation value
