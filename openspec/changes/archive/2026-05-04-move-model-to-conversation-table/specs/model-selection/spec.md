## Purpose
Allows the user to select the AI model used for a task from the chat drawer, and allows workflow columns to declare a preferred model in YAML.

## Requirements

### Requirement: User can select the AI model for a task from the chat drawer
The system SHALL allow the user to select an AI model from a searchable dropdown in the task detail drawer. The dropdown SHALL show models returned by the active engine's `listModels()`. For Copilot, the dropdown SHALL always include `Auto` as the first selectable option, and that option SHALL be represented by the explicit model ID "auto" (not null). The selected model SHALL be persisted on the conversation and used for all subsequent executions of that task.

#### Scenario: Searchable model dropdown shows engine models grouped by provider
- **WHEN** the task detail drawer opens and `models.listEnabled` returns a non-empty list
- **THEN** a searchable model-selection dropdown is shown, pre-selected to the task's current model, with models grouped under their provider name

#### Scenario: Copilot dropdown includes Auto as first option
- **WHEN** the active engine is Copilot and the model selector is rendered
- **THEN** the first option is `Auto`
- **AND** its model identity is `"auto"`
- **AND** its description explains that Copilot chooses the best available model based on task context, availability, and subscription access

#### Scenario: User can filter models by typing
- **WHEN** the user opens the model dropdown and types a search string
- **THEN** only models whose id contains the typed string (case-insensitive) are shown

#### Scenario: Model selection persisted to conversation
- **WHEN** the user selects a different model from the dropdown
- **THEN** the conversation's `model` field is updated and all subsequent executions use that model

#### Scenario: Auto selection persists as "auto" conversation model
- **WHEN** the user selects `Auto` in the Copilot model dropdown
- **THEN** the conversation's `model` is persisted as `"auto"`
- **AND** subsequent executions run without a pinned Copilot model (backend translates "auto" to empty string for engine)

#### Scenario: Model resets to column default on column transition
- **WHEN** a task is moved to a new workflow column AND the column has a model defined
- **THEN** the conversation's `model` is set to the column's configured `model` field

#### Scenario: Model preserved when column has no model
- **WHEN** a task is moved to a new workflow column AND the column has NO model defined
- **THEN** the conversation's `model` remains unchanged (user's selection is preserved)

### Requirement: Workflow column can declare a preferred model as a fully-qualified ID
The system SHALL allow each workflow column to declare an optional `model` field in the workflow YAML. When a task transitions into a column that has a model defined, the conversation's model SHALL be updated to the column's model. When a task transitions into a column with no model defined, the conversation's model SHALL be left unchanged. The effective model for execution SHALL be: `conversation.model → engine.model → ""`. When a column has no model configured, `conversation.model` is preserved; the `engine.model` from workspace config is used as a fallback only when `conversation.model` is also null.

#### Scenario: Column model applied on entry as fully-qualified ID
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` defined
- **THEN** the conversation's `model` is updated to `"anthropic/claude-opus-4-5"` before any execution is started

#### Scenario: Column model applied on entry (Claude)
- **WHEN** a task transitions into a column that has `model: "claude-sonnet-4-6"` and the active engine is Claude
- **THEN** the conversation's `model` is updated to `"claude-sonnet-4-6"` and passed to the Claude engine

#### Scenario: Conversation model preserved when column has no model
- **WHEN** a task transitions into a column with no `model` field and the conversation has `model: "gpt-4.1"` set
- **THEN** the conversation's `model` remains `"gpt-4.1"` and subsequent executions use that model