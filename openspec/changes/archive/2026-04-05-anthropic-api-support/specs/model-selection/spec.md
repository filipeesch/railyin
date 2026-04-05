## MODIFIED Requirements

### Requirement: User can select the AI model for a task from the chat drawer
The system SHALL allow the user to select an AI model from a dropdown in the task detail drawer. The selected model SHALL be stored as a fully-qualified model ID (`providerId/modelId`) on the task and used for all subsequent executions of that task.

#### Scenario: Model dropdown shows all models from all providers
- **WHEN** the task detail drawer opens and `models.list` returns a non-empty list
- **THEN** a model-selection dropdown shows all models from all configured providers as a flat list, with fully-qualified IDs (e.g., `anthropic/claude-3-5-sonnet-20241022`, `lmstudio/qwen3-8b`)

#### Scenario: Model label shown when no providers have available models
- **WHEN** `models.list` returns an empty array
- **THEN** the dropdown is hidden and a read-only label shows the current model name if set

#### Scenario: Model selection persisted as fully-qualified ID
- **WHEN** the user selects a model from the dropdown
- **THEN** the task's `model` field is updated via `tasks.setModel` with the fully-qualified ID and all subsequent executions use that qualified model

#### Scenario: Model resets to column default on column transition
- **WHEN** a task is moved to a new workflow column
- **THEN** the task's `model` is set to the column's configured `model` field (expected to be a fully-qualified ID), or `null` if the column has none

### Requirement: Workflow column can declare a preferred model as a fully-qualified ID
The system SHALL allow each workflow column to declare an optional `model` field in the workflow YAML. This value SHALL be a fully-qualified model ID (`providerId/modelId`) and is used as the default for tasks entering that column.

#### Scenario: Column model applied on entry as fully-qualified ID
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` defined
- **THEN** the task's `model` is updated to `"anthropic/claude-opus-4-5"` before any execution is started

#### Scenario: Task model set to null when column has no model
- **WHEN** a task transitions into a column with no `model` field
- **THEN** the task's `model` is set to `null`, and on the next execution attempt the engine moves the task to `awaiting_user`

### Requirement: Available models are fetched from all configured providers
The system SHALL call `models.list` which fans out to all configured providers and returns a merged list. All model IDs SHALL be fully-qualified.

#### Scenario: Models returned with provider prefix and context window
- **WHEN** multiple providers are configured and at least one responds to its model list endpoint
- **THEN** `models.list` returns `[{ id: "providerId/modelId", contextWindow: number | null }, ...]`

#### Scenario: Empty list when all providers unreachable
- **WHEN** all configured providers fail to return a model list
- **THEN** `models.list` returns an empty array without throwing

## MODIFIED Requirements (continued)

### Requirement: Context window tokens config is a fallback override only
The `context_window_tokens` field, if present in a provider config entry, SHALL serve as a manual override for the model's context window size. It is used only when the model's context window cannot be determined from the model list response.

#### Scenario: API context window takes precedence over config
- **WHEN** the selected model has a `contextWindow` value from `models.list`
- **THEN** that value is used for context usage estimation, ignoring `context_window_tokens` from config

#### Scenario: Config value used when API context window is null
- **WHEN** the selected model's `contextWindow` is `null` and `context_window_tokens` is set in the provider's config entry
- **THEN** `context_window_tokens` is used as the effective context window

#### Scenario: Default used when both API and config are absent
- **WHEN** the selected model's `contextWindow` is `null` and no `context_window_tokens` is set
- **THEN** 128,000 tokens is used as the default context window
