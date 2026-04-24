## ADDED Requirements

### Requirement: Enabled model lists are workspace-level shared state
The system SHALL expose enabled model lists as workspace-level shared state so both task chat and standalone session chat consume the same model availability source.

#### Scenario: Task and session chats see same enabled models
- **WHEN** the enabled model list is loaded for the active workspace
- **THEN** both task chat and standalone session chat render the same available model options from that shared workspace-level source

#### Scenario: Model availability updates once for all chat surfaces
- **WHEN** the enabled model list changes for the active workspace
- **THEN** both task and session chat reflect the updated list without maintaining separate task-owned copies of the model data

