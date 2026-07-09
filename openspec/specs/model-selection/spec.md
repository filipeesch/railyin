## Purpose
Allows the user to select the AI model used for a task from the chat drawer, and allows workflow columns to declare a preferred model in YAML.

## Requirements

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

### Requirement: Available models are fetched dynamically from the provider
The system SHALL expose a `models.list` RPC that delegates to the active engine's `listModels()` method. For the Pi engine, this calls `GET {base_url}/v1/models` on each configured provider. For the Copilot engine, this returns models available through the Copilot subscription. For the Claude engine, this returns models available through the Claude Agent SDK in the same provider-grouped shape used by the rest of the product, with a single Claude provider group.

Each model entry in `ProviderModelList.models` SHALL include a `contextWindowEditable?: boolean` field. This field SHALL be `true` only when the engine signals that context window is user-configurable for this model (Pi and OpenCode engines). Copilot and Claude model entries SHALL NOT include this field (or it SHALL be `false`/absent).

The `contextWindow` value returned for each model SHALL reflect the following precedence: user override from `model_settings` DB → server-reported value from `/v1/models` → engine default (128,000 for Pi). The raw server-reported value is not exposed separately.

#### Scenario: Models returned grouped by provider with enabled flags
- **WHEN** all configured providers respond with valid model lists
- **THEN** `models.list` returns `ProviderModelList[]` — one entry per provider — each containing the provider `id`, a `models` array of `{ id: string, contextWindow: number | null, enabled: boolean }`, and no `error` field

#### Scenario: Failed provider included with error, not omitted
- **WHEN** one provider's `/v1/models` request fails and another succeeds
- **THEN** `models.list` returns one entry per provider: the failed provider has `error` set and an empty `models` array; the successful provider has its full model list

#### Scenario: Claude engine returns available models
- **WHEN** the active engine is Claude and `models.list` is called
- **THEN** the engine returns models available through the Claude SDK in the shared grouped model format with a single `claude` provider group

#### Scenario: Pi model contextWindow reflects DB override
- **WHEN** a user override exists in `model_settings` for a Pi model
- **THEN** `models.list` returns `contextWindow` equal to the override value, not the server-reported value

#### Scenario: Pi model contextWindow falls back to engine default when no override
- **WHEN** no override exists and the server does not report a context length
- **THEN** `models.list` returns `contextWindow: 128000` for that model

#### Scenario: Pi model rows have contextWindowEditable true
- **WHEN** `models.list` is called and Pi engine models are returned
- **THEN** each Pi model entry has `contextWindowEditable: true`

#### Scenario: Copilot model rows do not have contextWindowEditable
- **WHEN** `models.list` is called and Copilot engine models are returned
- **THEN** Copilot model entries have `contextWindowEditable` absent or `false`

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

### Requirement: Model switch SHALL enforce compatibility and default persistence for conversation settings
When the selected model changes, the system SHALL evaluate existing conversation-scoped model-setting values against the new model's discovered capabilities. Compatible values SHALL be retained. Incompatible values SHALL be cleared. If no explicit user value exists and the new model exposes a default setting, that default SHALL be persisted to the conversation column.

#### Scenario: Compatible value is retained
- **WHEN** a conversation has setting value `medium` and the user switches to a model that supports `medium`
- **THEN** the conversation setting remains `medium`

#### Scenario: Incompatible value is cleared and control hidden
- **WHEN** a conversation has setting value `high` and the user switches to a model with no v1 setting support
- **THEN** the conversation setting is cleared
- **AND** the model-setting control is hidden

#### Scenario: Default is persisted on switch when no explicit value
- **WHEN** the user switches models and the conversation has no explicit setting value
- **AND** the selected model metadata exposes a default value
- **THEN** that default is persisted in the conversation column

### Requirement: Strict discovery only SHALL be used for model-setting capability
The system SHALL derive model-setting capability/options/defaults exclusively from provider/SDK discovery metadata. Static hardcoded model-name compatibility mappings SHALL NOT be used.

#### Scenario: Discovery metadata absent yields no capability
- **WHEN** provider discovery returns no model-setting metadata for a model
- **THEN** the model is treated as unsupported for v1 setting control
- **AND** no inferred capability is added from static mappings

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
