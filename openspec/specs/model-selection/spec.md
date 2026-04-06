## Purpose
Allows the user to select the AI model used for a task from the chat drawer, and allows workflow columns to declare a preferred model in YAML.

## Requirements

### Requirement: User can select the AI model for a task from the chat drawer
The system SHALL allow the user to select an AI model from a searchable dropdown in the task detail drawer. The dropdown SHALL show only the user's enabled models, support keyboard-driven text filtering, and group results by provider. The selected model SHALL be persisted on the task and used for all subsequent executions of that task.

#### Scenario: Searchable model dropdown shows enabled models grouped by provider
- **WHEN** the task detail drawer opens and `models.listEnabled` returns a non-empty list
- **THEN** a searchable model-selection dropdown (PrimeVue `Select` with `filter` enabled) is shown, pre-selected to the task's current model, with models grouped under their provider name via `optionGroupLabel`

#### Scenario: User can filter models by typing
- **WHEN** the user opens the model dropdown and types a search string
- **THEN** only models whose id contains the typed string (case-insensitive) are shown; groups with no matching models are hidden

#### Scenario: Empty state shown when no models are enabled
- **WHEN** `models.listEnabled` returns an empty array
- **THEN** the dropdown shows a single disabled option "No models enabled" and a "⚙ Manage models" button that opens `ManageModelsModal`

#### Scenario: Manage models button opens modal
- **WHEN** the user clicks the "⚙ Manage models" button at the bottom of the open dropdown (or in the empty state)
- **THEN** `ManageModelsModal` opens as an overlay; the dropdown closes

#### Scenario: Model selection persisted to task
- **WHEN** the user selects a different model from the dropdown
- **THEN** the task's `model` field is updated via `tasks.setModel` and all subsequent executions use that model

#### Scenario: Model resets to column default on column transition
- **WHEN** a task is moved to a new workflow column
- **THEN** the task's `model` is set to the column's configured `model` field, or the workspace default if the column has none

### Requirement: Workflow column can declare a preferred model as a fully-qualified ID
The system SHALL allow each workflow column to declare an optional `model` field in the workflow YAML. This value SHALL be a fully-qualified model ID (`providerId/modelId`) and is used as the default for tasks entering that column. Column model takes precedence over workspace `default_model`.

#### Scenario: Column model applied on entry as fully-qualified ID
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` defined
- **THEN** the task's `model` is updated to `"anthropic/claude-opus-4-5"` before any execution is started

#### Scenario: Task model set to null when column has no model
- **WHEN** a task transitions into a column with no `model` field
- **THEN** the task's `model` is set to `null`, and on the next execution attempt the engine moves the task to `waiting_user`

#### Scenario: Column model takes precedence over workspace default_model
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` defined and workspace has `default_model: "openrouter/gpt-4o"`
- **THEN** the task's `model` is set to `"anthropic/claude-opus-4-5"` (column wins)

### Requirement: Available models are fetched dynamically from the provider
The system SHALL expose a `models.list` RPC that calls `GET {base_url}/v1/models` on each configured provider and returns provider-grouped results including per-model enabled flags and context window sizes where known.

#### Scenario: Models returned grouped by provider with enabled flags
- **WHEN** all configured providers respond with valid model lists
- **THEN** `models.list` returns `ProviderModelList[]` — one entry per provider — each containing the provider `id`, a `models` array of `{ id: string, contextWindow: number | null, enabled: boolean }`, and no `error` field

#### Scenario: Failed provider included with error, not omitted
- **WHEN** one provider's `/v1/models` request fails and another succeeds
- **THEN** `models.list` returns one entry per provider: the failed provider has `error` set and an empty `models` array; the successful provider has its full model list

### Requirement: Workspace AI model is optional in configuration
The system SHALL NOT require `ai.model` to be set in `workspace.yaml`. When absent, task execution SHALL use the model set on the task itself. If neither is set, the AI provider call proceeds without an explicit model field (provider uses its default).

#### Scenario: Workspace starts without default_model set
- **WHEN** `workspace.yaml` has no `default_model` field
- **THEN** the system loads without a configuration error

#### Scenario: Task model used when workspace model absent
- **WHEN** a task has a model set and `default_model` is absent from workspace config
- **THEN** the task's model is used for AI calls

#### Scenario: Column default falls back to workspace default_model when column has no model
- **WHEN** a task transitions into a column with no `model` field and `default_model` is set in workspace config
- **THEN** the task's model is set to the workspace `default_model` value

#### Scenario: Column default falls back to null when neither column nor workspace specifies a model
- **WHEN** a task transitions into a column with no `model` field and `default_model` is not set in workspace config
- **THEN** the task's model is left unchanged (not overridden)

### Requirement: New tasks inherit workspace default_model on creation
The system SHALL set a newly created task's `model` to the workspace `default_model` when no explicit model is specified at creation time and `default_model` is configured.

#### Scenario: Task created without explicit model gets workspace default
- **WHEN** `create_task` is called without an `args.model` and workspace has `default_model: "anthropic/claude-sonnet-4-5"`
- **THEN** the new task's `model` field is set to `"anthropic/claude-sonnet-4-5"`

#### Scenario: Task created with explicit model ignores workspace default
- **WHEN** `create_task` is called with `args.model: "openrouter/gpt-4o"` and workspace has `default_model: "anthropic/claude-sonnet-4-5"`
- **THEN** the new task's `model` field is set to `"openrouter/gpt-4o"`

#### Scenario: Task created without model and no workspace default stays null
- **WHEN** `create_task` is called without an `args.model` and workspace has no `default_model`
- **THEN** the new task's `model` field is `null`

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
