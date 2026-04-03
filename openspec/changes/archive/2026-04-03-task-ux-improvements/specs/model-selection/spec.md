## ADDED Requirements

### Requirement: User can select the AI model for a task from the chat drawer
The system SHALL allow the user to select an AI model from a dropdown in the task detail drawer. The selected model SHALL be persisted on the task and used for all subsequent executions of that task.

#### Scenario: Model dropdown shown when models available
- **WHEN** the task detail drawer opens and the `models.list` RPC returns a non-empty list
- **THEN** a model-selection dropdown is shown in the side panel, pre-selected to the task's current model

#### Scenario: Model label shown when endpoint unavailable
- **WHEN** the `models.list` RPC returns an empty array (endpoint unavailable or unsupported)
- **THEN** the dropdown is hidden and a read-only label shows the current model name

#### Scenario: Model selection persisted to task
- **WHEN** the user selects a different model from the dropdown
- **THEN** the task's `model` field is updated via `tasks.setModel` and all subsequent executions use that model

#### Scenario: Model resets to column default on column transition
- **WHEN** a task is moved to a new workflow column
- **THEN** the task's `model` is set to the column's configured `model` field, or the workspace default if the column has none

### Requirement: Workflow column can declare a preferred model
The system SHALL allow each workflow column to declare an optional `model` field in the workflow YAML. This model is used as the default for tasks entering that column.

#### Scenario: Column model applied on entry
- **WHEN** a task transitions into a column that has a `model` field defined
- **THEN** the task's `model` is updated to the column's model before any execution is started

#### Scenario: Workspace model used when column has no model
- **WHEN** a task transitions into a column with no `model` field
- **THEN** the task's `model` is set to the workspace-level `ai.model` value

### Requirement: Available models are fetched dynamically from the provider
The system SHALL expose a `models.list` RPC that calls `GET {base_url}/v1/models` on the configured provider endpoint and returns the list of available model IDs.

#### Scenario: Models returned when endpoint responds
- **WHEN** the provider supports `/v1/models` and responds with a valid models list
- **THEN** `models.list` returns an array of model ID strings

#### Scenario: Empty list returned when endpoint fails
- **WHEN** the `/v1/models` request fails (network error, 404, or non-JSON response)
- **THEN** `models.list` returns an empty array without throwing
