## MODIFIED Requirements

### Requirement: Available models are fetched dynamically from the provider
The system SHALL expose a `models.list` RPC that delegates to the active engine's `listModels()` method. For the native engine, this calls `GET {base_url}/v1/models` on each configured provider. For the Copilot engine, this returns models available through the Copilot subscription. Results are returned in provider-grouped format including per-model enabled flags and context window sizes where known.

#### Scenario: Models returned grouped by provider with enabled flags (native engine)
- **WHEN** all configured native engine providers respond with valid model lists
- **THEN** `models.list` returns `ProviderModelList[]` — one entry per provider — each containing the provider `id`, a `models` array of `{ id: string, contextWindow: number | null, enabled: boolean }`, and no `error` field

#### Scenario: Failed provider included with error, not omitted
- **WHEN** one native engine provider's `/v1/models` request fails and another succeeds
- **THEN** `models.list` returns one entry per provider: the failed provider has `error` set and an empty `models` array; the successful provider has its full model list

#### Scenario: Copilot engine returns available models
- **WHEN** the active engine is Copilot and `models.list` is called
- **THEN** the engine returns models available through the Copilot subscription in the same `ProviderModelList[]` format with a single "copilot" provider group

### Requirement: Workflow column can declare a preferred model as a fully-qualified ID
The system SHALL allow each workflow column to declare an optional `model` field in the workflow YAML. This value SHALL be a fully-qualified model ID (`providerId/modelId`) for the native engine, or a plain model name for the Copilot engine. Column model takes precedence over the engine's default model.

#### Scenario: Column model applied on entry as fully-qualified ID (native)
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` and the active engine is native
- **THEN** the task's `model` is updated to `"anthropic/claude-opus-4-5"` before any execution is started

#### Scenario: Column model applied on entry (copilot)
- **WHEN** a task transitions into a column that has `model: "gpt-5"` and the active engine is copilot
- **THEN** the task's `model` is updated to `"gpt-5"` and passed to the CopilotSession

#### Scenario: Task model set to null when column has no model
- **WHEN** a task transitions into a column with no `model` field
- **THEN** the task's `model` is set to `null`, and on the next execution attempt the engine uses its default model or moves the task to `waiting_user`

#### Scenario: Column model takes precedence over engine default model
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` and the engine has a different default
- **THEN** the task's `model` is set to `"anthropic/claude-opus-4-5"` (column wins)

### Requirement: Workspace AI model is optional in configuration
The system SHALL NOT require a default model to be set in the engine config. For the native engine, `default_model` under the `engine:` block is optional. For the Copilot engine, `model` is optional. When absent, task execution SHALL use the model set on the task itself. If neither is set, the engine uses its own default behavior.

#### Scenario: Workspace starts without default_model set
- **WHEN** the engine config has no default model field
- **THEN** the system loads without a configuration error

#### Scenario: Task model used when engine default model absent
- **WHEN** a task has a model set and the engine config default is absent
- **THEN** the task's model is used for executions

#### Scenario: Column default falls back to engine default_model when column has no model
- **WHEN** a task transitions into a column with no `model` field and the engine config has a default model
- **THEN** the task's model is set to the engine's default model value

#### Scenario: Column default falls back to null when neither column nor engine specifies a model
- **WHEN** a task transitions into a column with no `model` field and the engine config has no default model
- **THEN** the task's model is left unchanged (not overridden)

### Requirement: New tasks inherit engine default_model on creation
The system SHALL set a newly created task's `model` to the engine's default model when no explicit model is specified at creation time and a default is configured.

#### Scenario: Task created without explicit model gets engine default
- **WHEN** `create_task` is called without an `args.model` and the engine config has a default model
- **THEN** the new task's `model` field is set to that default

#### Scenario: Task created with explicit model ignores engine default
- **WHEN** `create_task` is called with `args.model: "openrouter/gpt-4o"` and the engine has a different default
- **THEN** the new task's `model` field is set to `"openrouter/gpt-4o"`

#### Scenario: Task created without model and no engine default stays null
- **WHEN** `create_task` is called without an `args.model` and the engine config has no default model
- **THEN** the new task's `model` field is `null`

### Requirement: User can select the AI model for a task from the chat drawer
The system SHALL allow the user to select an AI model from a searchable dropdown in the task detail drawer. The dropdown SHALL show models returned by the active engine's `listModels()`. The selected model SHALL be persisted on the task and used for all subsequent executions of that task.

#### Scenario: Searchable model dropdown shows engine models grouped by provider
- **WHEN** the task detail drawer opens and `models.listEnabled` returns a non-empty list
- **THEN** a searchable model-selection dropdown is shown, pre-selected to the task's current model, with models grouped under their provider name

#### Scenario: User can filter models by typing
- **WHEN** the user opens the model dropdown and types a search string
- **THEN** only models whose id contains the typed string (case-insensitive) are shown

#### Scenario: Empty state shown when no models are available
- **WHEN** `models.listEnabled` returns an empty array
- **THEN** the dropdown shows a single disabled option "No models available"

#### Scenario: Model selection persisted to task
- **WHEN** the user selects a different model from the dropdown
- **THEN** the task's `model` field is updated via `tasks.setModel` and all subsequent executions use that model

#### Scenario: Model resets to column default on column transition
- **WHEN** a task is moved to a new workflow column
- **THEN** the task's `model` is set to the column's configured `model` field, or the engine default if the column has none
