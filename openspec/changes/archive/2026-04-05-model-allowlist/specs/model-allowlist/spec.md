## ADDED Requirements

### Requirement: Enabled models are persisted in the database
The system SHALL store per-workspace enabled model preferences in an `enabled_models` table with columns `workspace_id INTEGER` and `qualified_model_id TEXT`, with a composite primary key on both columns.

#### Scenario: Row inserted when model is enabled
- **WHEN** `models.setEnabled({ qualifiedModelId: "anthropic/claude-opus-4-5", enabled: true })` is called
- **THEN** a row `(workspace_id, "anthropic/claude-opus-4-5")` is upserted into `enabled_models`

#### Scenario: Row removed when model is disabled
- **WHEN** `models.setEnabled({ qualifiedModelId: "anthropic/claude-opus-4-5", enabled: false })` is called
- **THEN** the matching row is deleted from `enabled_models`; if no row existed, the operation is a no-op

#### Scenario: Orphaned rows are harmlessly ignored
- **WHEN** a provider is removed from `workspace.yaml` and its models no longer appear in `models.list`
- **THEN** the orphaned `enabled_models` rows remain in the DB but are not returned by `models.listEnabled`

### Requirement: models.list returns provider-grouped data with per-model enabled flags
The `models.list` RPC SHALL return `ProviderModelList[]` where each entry represents one configured provider. Each provider entry SHALL include all models fetched from that provider and a per-model `enabled` boolean joined from the `enabled_models` table.

#### Scenario: Successful provider fetch with mix of enabled and disabled
- **WHEN** a provider responds with models and some are in `enabled_models`
- **THEN** that provider's entry has `id` set to the provider id, `models` set to the full list each with `enabled: true/false`, and no `error` field

#### Scenario: Provider fetch fails
- **WHEN** a provider's `/v1/models` request fails (network error, non-JSON, 4xx/5xx)
- **THEN** that provider's entry has an `error` string describing the failure and an empty `models` array

#### Scenario: Model id is qualified with provider prefix
- **WHEN** provider `"anthropic"` returns model `"claude-opus-4-5"`
- **THEN** the model's `id` in the response is `"anthropic/claude-opus-4-5"`

### Requirement: models.setEnabled toggles a model's enabled state
The system SHALL expose a `models.setEnabled` RPC accepting `{ qualifiedModelId: string, enabled: boolean }` that upserts or deletes from the `enabled_models` table for the current workspace.

#### Scenario: Enable a model
- **WHEN** `models.setEnabled({ qualifiedModelId: "lmstudio/llama-3.2-1b", enabled: true })` is called
- **THEN** `models.listEnabled` subsequently includes `"lmstudio/llama-3.2-1b"`

#### Scenario: Disable a model
- **WHEN** `models.setEnabled({ qualifiedModelId: "lmstudio/llama-3.2-1b", enabled: false })` is called
- **THEN** `models.listEnabled` subsequently does not include `"lmstudio/llama-3.2-1b"`

### Requirement: models.listEnabled returns only enabled models
The system SHALL expose a `models.listEnabled` RPC that returns `ModelInfo[]` — a flat list of only the models currently in the `enabled_models` table, with context window info resolved from the provider at call time.

#### Scenario: Returns enabled models
- **WHEN** two models are in `enabled_models` and both providers are reachable
- **THEN** `models.listEnabled` returns exactly those two models with their `contextWindow` values

#### Scenario: Returns empty array when no models enabled
- **WHEN** `enabled_models` table has no rows for the current workspace
- **THEN** `models.listEnabled` returns `[]`

#### Scenario: Unreachable provider models still returned by id
- **WHEN** a model is in `enabled_models` but its provider is currently unreachable
- **THEN** `models.listEnabled` still returns the model entry with `contextWindow: null`

### Requirement: ModelTreeView displays all providers and their models with enable/disable checkboxes
The system SHALL provide a `ModelTreeView` Vue component that fetches `models.list` on mount and renders a tree: one collapsible row per provider containing a list of model rows each with a checkbox. Checking or unchecking a model calls `models.setEnabled` immediately.

#### Scenario: Component loads model list on mount
- **WHEN** `ModelTreeView` is mounted
- **THEN** it calls `models.list` and renders providers with their models and current enabled state

#### Scenario: Provider row shows error state
- **WHEN** a provider entry has an `error` field
- **THEN** that provider's row shows an error message and a "Refresh" button; its model list is empty

#### Scenario: Per-provider refresh re-fetches full list
- **WHEN** the user clicks the "Refresh" button on a provider row
- **THEN** `models.list` is called again and the component updates the affected provider's model list in place

#### Scenario: Checking a model checkbox enables it immediately
- **WHEN** the user checks the checkbox next to a model
- **THEN** `models.setEnabled({ qualifiedModelId, enabled: true })` is called and the checkbox reflects the new state

#### Scenario: Unchecking a model checkbox disables it immediately
- **WHEN** the user unchecks the checkbox next to a model
- **THEN** `models.setEnabled({ qualifiedModelId, enabled: false })` is called and the checkbox reflects the new state

### Requirement: Config screen has a Models tab backed by ModelTreeView
The system SHALL add a "Models" tab to the config/setup screen (`SetupView.vue`) that embeds `ModelTreeView`. The tab SHALL be the entry point for managing the model allowlist from settings.

#### Scenario: Models tab renders ModelTreeView
- **WHEN** the user navigates to the config screen and clicks the "Models" tab
- **THEN** `ModelTreeView` is mounted and begins loading provider data

### Requirement: ManageModelsModal gives in-context access to the model allowlist
The system SHALL provide a `ManageModelsModal` Vue component that wraps `ModelTreeView` in a modal overlay, allowing users to manage the allowlist without leaving the task context.

#### Scenario: Modal opens when triggered
- **WHEN** the "⚙ Manage models" button is clicked (from either the chat dropdown or an empty-state CTA)
- **THEN** `ManageModelsModal` is displayed over the current view with `ModelTreeView` inside

#### Scenario: Modal closes on dismiss
- **WHEN** the user clicks outside the modal or a close button
- **THEN** the modal is dismissed and the chat dropdown reflects any changes made
