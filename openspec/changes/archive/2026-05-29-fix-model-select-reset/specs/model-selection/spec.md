## MODIFIED Requirements

### Requirement: Enabled model lists are workspace-level shared state
The system SHALL expose enabled model lists as workspace-level shared state so both task chat and standalone session chat consume the same model availability source. The selected model SHALL be preserved in the frontend store across all WebSocket push events — including cancel, shell approval, code review, and session operations — without any client-side guard or workaround. The backend SHALL ensure every `task.updated` and `chatSession.updated` push event carries the correct `model` value by using the shared DB helpers that include the `conversations` JOIN.

#### Scenario: Task and session chats see same enabled models
- **WHEN** the enabled model list is loaded for the active workspace
- **THEN** both task chat and standalone session chat render the same available model options from that shared workspace-level source

#### Scenario: Model availability updates once for all chat surfaces
- **WHEN** the enabled model list changes for the active workspace
- **THEN** both task and session chat reflect the updated list without maintaining separate task-owned copies of the model data

#### Scenario: Model selection preserved after cancel execution
- **WHEN** a user sets the task model to `"gpt-4.1"` and then cancels a running execution
- **THEN** the model dropdown still shows `"gpt-4.1"` after the cancellation completes

#### Scenario: Model selection preserved after shell approval
- **WHEN** a user sets the task model to `"claude-sonnet-4-6"` and then approves a shell command
- **THEN** the model dropdown still shows `"claude-sonnet-4-6"` after the approval completes

#### Scenario: Model selection preserved after chatSessions.setModel
- **WHEN** a user changes the session model to `"gpt-4.1"` via the model dropdown
- **THEN** the model dropdown continues to show `"gpt-4.1"` and does not reset to the first available model
