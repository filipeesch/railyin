## ADDED Requirements

### Requirement: Session chat SHALL expose conversation-scoped reasoning-mode control
Standalone session chat SHALL render the same v1 model-setting control behavior as task chat, driven by conversation model metadata from `models.listEnabled`.

#### Scenario: Session chat shows control for supported model
- **WHEN** a chat session conversation uses a model with non-empty supported setting values
- **THEN** session chat renders the reasoning-mode selector

#### Scenario: Session chat hides control for unsupported model
- **WHEN** a chat session conversation uses a model with no supported setting values
- **THEN** session chat hides the reasoning-mode selector

### Requirement: Session chat selection SHALL persist and survive model switches
Session chat SHALL persist selected setting values on the conversation and apply model-switch compatibility/default rules identically to task chat.

#### Scenario: Session chat retains compatible value after model switch
- **WHEN** the user switches to a session model that still supports the current setting value
- **THEN** the session conversation keeps the existing value

#### Scenario: Session chat clears incompatible value and applies discovered default
- **WHEN** the user switches to a session model where the current setting value is incompatible
- **THEN** the old value is cleared
- **AND** if the new model exposes a default and there is no explicit override, that default is persisted
