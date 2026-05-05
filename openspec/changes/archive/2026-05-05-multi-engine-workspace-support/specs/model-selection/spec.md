## MODIFIED Requirements

### Requirement: User can select the AI model for a task from the chat drawer
The system SHALL allow the user to select an AI model from a searchable dropdown in the task detail drawer. The dropdown SHALL show models aggregated from ALL workspace-allowed engines via `listAllEngines(workspaceKey)`, each engine's `listModels()` results merged into a single list. Models SHALL be grouped by engine, then by provider. For Copilot, `Auto` SHALL remain the first selectable option representing a null model identity. The selected model SHALL be persisted on the conversation as a `QualifiedModelId` string and used for all subsequent executions.

#### Scenario: Model picker shows models from all allowed engines
- **WHEN** the task detail drawer opens and the workspace allows copilot and opencode
- **THEN** the model dropdown shows models from both engines, grouped by engine

#### Scenario: Copilot dropdown still includes Auto as first option
- **WHEN** copilot is one of the allowed engines and the model selector is rendered
- **THEN** `Auto` appears as the first option under the Copilot group with null model identity

#### Scenario: User can filter models by typing
- **WHEN** the user types in the model search box
- **THEN** models from all engines are filtered case-insensitively by the typed string

#### Scenario: Model selection persisted as QualifiedModelId
- **WHEN** the user selects `opencode/anthropic/claude-sonnet-4-5` from the dropdown
- **THEN** `conversations.model` is set to `"opencode/anthropic/claude-sonnet-4-5"`
- **AND** all subsequent executions route to the OpenCode engine

#### Scenario: Model resets to column default on column transition
- **WHEN** a task transitions to a column with `model: "claude/claude-sonnet-4-5"` defined
- **THEN** the conversation model is updated to that qualified ID before execution

#### Scenario: Model preserved when column has no model
- **WHEN** a task transitions to a column with no `model` field
- **THEN** the conversation's model is unchanged
