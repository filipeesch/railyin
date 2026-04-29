## Purpose
Allows the user to select the AI model used for a task from the chat drawer, and allows workflow columns to declare a preferred model in YAML.

## Requirements

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

### Requirement: Workflow column can declare a preferred model as a fully-qualified ID
The system SHALL allow each workflow column to declare an optional `model` field in the workflow YAML. When a task transitions into a column, the effective model SHALL be resolved in priority order: `column.model → task.model → engine.model → ""`. Column model takes precedence over all other sources. When a column has no model configured, `task.model` is preserved; the `engine.model` from workspace config is used as a fallback only when `task.model` is also null.

#### Scenario: Column model applied on entry as fully-qualified ID
- **WHEN** a task transitions into a column that has `model: "anthropic/claude-opus-4-5"` defined
- **THEN** the task's `model` is updated to `"anthropic/claude-opus-4-5"` before any execution is started

#### Scenario: Column model applied on entry (Claude)
- **WHEN** a task transitions into a column that has `model: "claude-sonnet-4-6"` and the active engine is Claude
- **THEN** the task's `model` is updated to `"claude-sonnet-4-6"` and passed to the Claude engine

#### Scenario: Task model preserved when column has no model
- **WHEN** a task transitions into a column with no `model` field and the task has `model: "gpt-4.1"` set
- **THEN** the task's `model` remains `"gpt-4.1"` and subsequent executions use that model

#### Scenario: Column default falls back to engine.model when task model is null
- **WHEN** a task transitions into a column with no `model` field, `task.model` is null, and `engine.model` is set to `"gpt-4.1"` in workspace config
- **THEN** the task's `model` is set to `"gpt-4.1"` before execution

#### Scenario: Column default falls back to null when neither column nor task nor engine specifies a model
- **WHEN** a task transitions into a column with no `model` field, `task.model` is null, and `engine.model` is not set in workspace config
- **THEN** the task's `model` is left unchanged (null) and the engine uses its built-in default

### Requirement: Available models are fetched dynamically from the provider
The system SHALL expose a `models.list` RPC that delegates to the active engine's `listModels()` method. For the native engine, this calls `GET {base_url}/v1/models` on each configured provider. For the Copilot engine, this returns models available through the Copilot subscription. For the Claude engine, this returns models available through the Claude Agent SDK in the same provider-grouped shape used by the rest of the product, with a single Claude provider group.

#### Scenario: Models returned grouped by provider with enabled flags
- **WHEN** all configured providers respond with valid model lists
- **THEN** `models.list` returns `ProviderModelList[]` — one entry per provider — each containing the provider `id`, a `models` array of `{ id: string, contextWindow: number | null, enabled: boolean }`, and no `error` field

#### Scenario: Failed provider included with error, not omitted
- **WHEN** one provider's `/v1/models` request fails and another succeeds
- **THEN** `models.list` returns one entry per provider: the failed provider has `error` set and an empty `models` array; the successful provider has its full model list

#### Scenario: Claude engine returns available models
- **WHEN** the active engine is Claude and `models.list` is called
- **THEN** the engine returns models available through the Claude SDK in the shared grouped model format with a single `claude` provider group

### Requirement: Workspace AI model is optional in configuration
The system SHALL NOT require a default model to be set in engine config. For the native engine, `default_model` under the `engine:` block is optional. For non-native engines such as Copilot and Claude, `engine.model` is optional. When absent, task execution SHALL use the model set on the task itself. If neither is set, the engine uses its own default behavior.

#### Scenario: Workspace starts without default_model set
- **WHEN** `workspace.yaml` has no `default_model` field
- **THEN** the system loads without a configuration error

#### Scenario: Task model used when workspace model absent
- **WHEN** a task has a model set and `default_model` is absent from workspace config
- **THEN** the task's model is used for AI calls

#### Scenario: Claude engine starts without default model
- **WHEN** `workspace.yaml` has `engine: { type: claude }` and a task has no explicit model
- **THEN** the system loads successfully and the Claude engine uses SDK-default model behavior until a task or column model is chosen

### Requirement: New tasks inherit workspace engine model on creation
The system SHALL set a newly created task's `model` to the workspace `engine.model` when no explicit model is specified at creation time and `engine.model` is configured. This applies to tasks created via the `tasks.create` RPC handler.

#### Scenario: Task created without explicit model gets engine.model as default
- **WHEN** `tasks.create` is called and workspace has `engine.model: "gpt-4.1"` configured
- **THEN** the new task's `model` field is set to `"gpt-4.1"`

#### Scenario: Task created without model and no engine.model stays null
- **WHEN** `tasks.create` is called and workspace has no `engine.model` configured
- **THEN** the new task's `model` field is `null`

### Requirement: Human turn and retry executions fall back to engine.model when task model is null
The system SHALL resolve `engine.model` as a fallback in `HumanTurnExecutor` and `RetryExecutor` when `task.model` is null at execution time. When `engine.model` is used as the fallback, the resolved model SHALL be written back to `task.model` in the database so subsequent executions find it without re-resolving from config.

#### Scenario: Human turn uses engine.model when task model is null
- **WHEN** a user sends a message to a task whose `model` is null and `engine.model` is set to `"claude-sonnet-4-6"`
- **THEN** the execution uses `"claude-sonnet-4-6"` as the model
- **AND** `task.model` is updated to `"claude-sonnet-4-6"` in the database

#### Scenario: Human turn preserves task model when set
- **WHEN** a user sends a message to a task whose `model` is `"gpt-4.1"`
- **THEN** the execution uses `"gpt-4.1"` as the model regardless of `engine.model`

#### Scenario: Retry uses engine.model when task model is null
- **WHEN** a retry is triggered on a task whose `model` is null and `engine.model` is set to `"gpt-4.1"`
- **THEN** the retry execution uses `"gpt-4.1"` as the model
- **AND** `task.model` is updated to `"gpt-4.1"` in the database

#### Scenario: Engine-lost fallback resolves engine.model when task model is null
- **WHEN** a `HumanTurnExecutor` execution is started for a task with `model = null`, `engine.resume()` throws (session lost), and `engine.model` is configured
- **THEN** the fallback fresh execution uses `engine.model` as the model
- **AND** `task.model` is updated in the database with the resolved value

### Requirement: Model resolution uses a single canonical utility function
The system SHALL use a single `resolveTaskModel(columnModel, taskModel, engineConfig)` pure function as the canonical implementation of the model priority chain across all task execution paths. The function SHALL return a `string` (empty string when all sources are null/undefined). The function SHALL use `||` (not `??`) so that empty string values fall through to the next source, treated equivalently to `null` or `undefined`.

#### Scenario: resolveTaskModel returns column model when set
- **WHEN** `columnModel` is `"gpt-4.1"`, `taskModel` is `"claude-sonnet-4-6"`, and `engineConfig.model` is `"other-model"`
- **THEN** `resolveTaskModel` returns `"gpt-4.1"`

#### Scenario: resolveTaskModel returns task model when column is null
- **WHEN** `columnModel` is null, `taskModel` is `"claude-sonnet-4-6"`, and `engineConfig.model` is `"other-model"`
- **THEN** `resolveTaskModel` returns `"claude-sonnet-4-6"`

#### Scenario: resolveTaskModel returns engine model when column and task are null
- **WHEN** `columnModel` is null, `taskModel` is null, and `engineConfig.model` is `"gpt-4.1"`
- **THEN** `resolveTaskModel` returns `"gpt-4.1"`

#### Scenario: resolveTaskModel returns empty string when all sources are null
- **WHEN** `columnModel` is null, `taskModel` is null, and `engineConfig` has no `model` property
- **THEN** `resolveTaskModel` returns `""`

#### Scenario: Empty column model falls through to task model
- **WHEN** `columnModel` is `""` (empty string) and `taskModel` is `"gpt-4.1"`
- **THEN** `resolveTaskModel` returns `"gpt-4.1"`

#### Scenario: Empty task model falls through to engine model
- **WHEN** `columnModel` is null, `taskModel` is `""` (empty string), and `engineConfig.model` is `"gpt-4.1"`
- **THEN** `resolveTaskModel` returns `"gpt-4.1"`

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

### Requirement: Enabled model lists are workspace-level shared state
The system SHALL expose enabled model lists as workspace-level shared state so both task chat and standalone session chat consume the same model availability source.

#### Scenario: Task and session chats see same enabled models
- **WHEN** the enabled model list is loaded for the active workspace
- **THEN** both task chat and standalone session chat render the same available model options from that shared workspace-level source

#### Scenario: Model availability updates once for all chat surfaces
- **WHEN** the enabled model list changes for the active workspace
- **THEN** both task and session chat reflect the updated list without maintaining separate task-owned copies of the model data
