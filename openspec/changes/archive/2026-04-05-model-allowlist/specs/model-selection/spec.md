## MODIFIED Requirements

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

### Requirement: Available models are fetched dynamically from the provider
The system SHALL expose a `models.list` RPC that calls `GET {base_url}/v1/models` on each configured provider and returns provider-grouped results including per-model enabled flags and context window sizes where known.

#### Scenario: Models returned grouped by provider with enabled flags
- **WHEN** all configured providers respond with valid model lists
- **THEN** `models.list` returns `ProviderModelList[]` — one entry per provider — each containing the provider `id`, a `models` array of `{ id: string, contextWindow: number | null, enabled: boolean }`, and no `error` field

#### Scenario: Failed provider included with error, not omitted
- **WHEN** one provider's `/v1/models` request fails and another succeeds
- **THEN** `models.list` returns one entry per provider: the failed provider has `error` set and an empty `models` array; the successful provider has its full model list
