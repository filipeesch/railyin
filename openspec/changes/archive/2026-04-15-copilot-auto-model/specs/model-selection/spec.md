## MODIFIED Requirements

### Requirement: User can select the AI model for a task from the chat drawer
The system SHALL allow the user to select an AI model from a searchable dropdown in the task detail drawer. The dropdown SHALL show models returned by the active engine's `listModels()`. For Copilot, the dropdown SHALL always include `Auto` as the first selectable option, and that option SHALL represent a null model identity (no pinned model). The selected model SHALL be persisted on the task and used for all subsequent executions of that task.

#### Scenario: Searchable model dropdown shows engine models grouped by provider
- **WHEN** the task detail drawer opens and `models.listEnabled` returns a non-empty list
- **THEN** a searchable model-selection dropdown is shown, pre-selected to the task's current model, with models grouped under their provider name

#### Scenario: Copilot dropdown includes Auto as first option
- **WHEN** the active engine is Copilot and the model selector is rendered
- **THEN** the first option is `Auto`
- **AND** its model identity is `null`
- **AND** its description explains that Copilot chooses the best available model based on task context, availability, and subscription access

#### Scenario: User can filter models by typing
- **WHEN** the user opens the model dropdown and types a search string
- **THEN** only models whose id contains the typed string (case-insensitive) are shown

#### Scenario: Model selection persisted to task
- **WHEN** the user selects a different model from the dropdown
- **THEN** the task's `model` field is updated via `tasks.setModel` and all subsequent executions use that model

#### Scenario: Auto selection persists as null task model
- **WHEN** the user selects `Auto` in the Copilot model dropdown
- **THEN** `tasks.setModel` persists `task.model = null`
- **AND** subsequent executions run without a pinned Copilot model

#### Scenario: Model resets to column default on column transition
- **WHEN** a task is moved to a new workflow column
- **THEN** the task's `model` is set to the column's configured `model` field, or the workspace default if the column has none
