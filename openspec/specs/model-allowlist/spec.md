## Purpose
The model allowlist lets users curate which AI models appear in the task model selector. All models fetched from configured providers are known to the system, but only those the user has explicitly enabled appear in the dropdown.

## Requirements

### Requirement: Enabled models are persisted in the database
The system SHALL store enabled model selections in an `enabled_models` table with columns `(workspace_id, qualified_model_id)`. A model is enabled if and only if a row exists for the given workspace and model ID combination.

#### Scenario: Enabling a model creates a row
- **WHEN** `models.setEnabled({ qualifiedModelId: "anthropic/claude-3-5-sonnet", enabled: true })` is called
- **THEN** a row is inserted into `enabled_models` for the current workspace and that model ID (if it does not already exist)

#### Scenario: Disabling a model removes the row
- **WHEN** `models.setEnabled({ qualifiedModelId: "anthropic/claude-3-5-sonnet", enabled: false })` is called
- **THEN** the matching row is deleted from `enabled_models`

### Requirement: models.list returns per-model enabled flags grouped by provider
The system SHALL expose a `models.list` RPC that fans out to all configured providers, attaches an `enabled` boolean to each model by cross-referencing `enabled_models`, and returns provider-grouped results as `ProviderModelList[]`.

#### Scenario: Enabled flag set correctly per model
- **WHEN** model `"anthropic/claude-opus-4-5"` is in `enabled_models` and `"anthropic/claude-3-haiku"` is not
- **THEN** `models.list` returns an Anthropic entry with `claude-opus-4-5` having `enabled: true` and `claude-3-haiku` having `enabled: false`

#### Scenario: Provider error included without breaking other providers
- **WHEN** one provider's model list endpoint fails
- **THEN** `models.list` returns that provider's entry with `error` set and `models: []`, while other providers return their full lists

### Requirement: models.setEnabled RPC toggles an individual model
The system SHALL expose `models.setEnabled({ qualifiedModelId: string, enabled: boolean })` which inserts or deletes a row in `enabled_models` and returns `{ success: true }`.

#### Scenario: Setting enabled true is idempotent
- **WHEN** `models.setEnabled({ qualifiedModelId: "openrouter/gpt-4o", enabled: true })` is called twice
- **THEN** only one row exists in `enabled_models` and no error is thrown

### Requirement: models.listEnabled RPC returns flat enabled model list
The system SHALL expose `models.listEnabled()` which queries `enabled_models` and returns a flat array of `ModelInfo` objects suitable for display in the task model selector dropdown.

#### Scenario: Empty list returned when no models enabled
- **WHEN** `enabled_models` is empty for the workspace
- **THEN** `models.listEnabled` returns `[]`

#### Scenario: Enabled models returned with provider grouping metadata
- **WHEN** `enabled_models` contains rows for two models from two different providers
- **THEN** `models.listEnabled` returns `ModelInfo[]` with `providerId` and `modelId` fields set correctly for each

### Requirement: ModelTreeView renders collapsible provider groups with checkboxes
The system SHALL implement a `ModelTreeView` component that receives `ProviderModelList[]` as a prop and renders each provider as a collapsible group with a refresh button. Each model within a group is shown with a checkbox reflecting its `enabled` state.

#### Scenario: Checking a model enables it
- **WHEN** the user checks a model's checkbox in `ModelTreeView`
- **THEN** `models.setEnabled` is called with `enabled: true` and the checkbox state is updated optimistically

#### Scenario: Unchecking a model disables it
- **WHEN** the user unchecks a model's checkbox in `ModelTreeView`
- **THEN** `models.setEnabled` is called with `enabled: false` and the checkbox state is updated optimistically

#### Scenario: Refresh button reloads a single provider's models
- **WHEN** the user clicks the refresh icon next to a provider group
- **THEN** only that provider's model list is re-fetched and the view is updated

#### Scenario: Error state shown for failed provider
- **WHEN** a provider entry in `ProviderModelList[]` has an `error` field set
- **THEN** the provider group shows an error message and a retry button

### Requirement: A Models tab in the config screen hosts the ModelTreeView
The system SHALL add a "Models" tab to the workspace configuration screen (`SetupView`). This tab renders a `ModelTreeView` component that loads all provider models on mount.

#### Scenario: Models tab shows all configured provider models
- **WHEN** the user opens the config screen and selects the "Models" tab
- **THEN** `ModelTreeView` is shown with all configured providers and their available models, each with an enabled/disabled checkbox

### Requirement: ManageModelsModal wraps ModelTreeView in an overlay
The system SHALL implement a `ManageModelsModal` component that renders `ModelTreeView` inside a PrimeVue `Dialog` overlay. The modal is triggered from the task model selector when no models are enabled or from a "Manage models" footer button in the model dropdown.

#### Scenario: Modal closed after user enables a model
- **WHEN** the user enables at least one model inside `ManageModelsModal` and closes it
- **THEN** the task model dropdown refreshes its list from `models.listEnabled`
