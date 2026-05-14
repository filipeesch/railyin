## MODIFIED Requirements

### Requirement: Model settings stored per workspace and model
The system SHALL store per-model user preferences in a `model_settings` DB table keyed by `(workspace_key TEXT, qualified_model_id TEXT)`. The `context_window INTEGER NULL` column stores the user-configured value. A `NULL` value means the model has no configured context window and SHALL be excluded from the chat model picker. The model SHALL still appear in the model settings setup page so the user can configure it.

#### Scenario: Table created by migration
- **WHEN** the Bun server starts and migration 043 runs
- **THEN** a `model_settings` table exists with PRIMARY KEY `(workspace_key, qualified_model_id)` and a nullable `context_window INTEGER` column

#### Scenario: Override stored on set
- **WHEN** `models.setContextWindow` is called with `qualifiedModelId: "pi-local/lmstudio/qwen3:8b"` and `contextWindow: 32768`
- **THEN** a row is upserted in `model_settings` with those values and the active workspace key

#### Scenario: Override cleared on null
- **WHEN** `models.setContextWindow` is called with `contextWindow: null`
- **THEN** the row is deleted (or its `context_window` set to NULL)

#### Scenario: Model excluded from chat picker when context_window is null
- **WHEN** `models.listEnabled` is called and a model has no `context_window` set in `model_settings`
- **THEN** that model is NOT included in the response

#### Scenario: Model visible in setup page when context_window is null
- **WHEN** `models.list` is called and a model has no `context_window` set in `model_settings`
- **THEN** that model IS included in the response so the user can configure it

#### Scenario: Setup page shows warning for unconfigured models
- **WHEN** the model setup page renders a Pi model with `contextWindow === null` and `contextWindowEditable === true`
- **THEN** a warning badge is displayed indicating the model will not appear in the chat picker until a context window is configured
