## ADDED Requirements

### Requirement: Model settings stored per workspace and model
The system SHALL store per-model user preferences in a `model_settings` DB table keyed by `(workspace_key TEXT, qualified_model_id TEXT)`. The initial column SHALL be `context_window INTEGER NULL`. A `NULL` value means "no override; use engine default."

#### Scenario: Table created by migration
- **WHEN** the Bun server starts and migration 043 runs
- **THEN** a `model_settings` table exists with PRIMARY KEY `(workspace_key, qualified_model_id)` and a nullable `context_window INTEGER` column

#### Scenario: Override stored on set
- **WHEN** `models.setContextWindow` is called with `qualifiedModelId: "pi-local/lmstudio/qwen3:8b"` and `contextWindow: 32768`
- **THEN** a row is upserted in `model_settings` with those values and the active workspace key

#### Scenario: Override cleared on null
- **WHEN** `models.setContextWindow` is called with `contextWindow: null`
- **THEN** the row is deleted (or its `context_window` set to NULL) so the engine default takes effect

### Requirement: ModelSettingsRepository interface
The system SHALL expose a `ModelSettingsRepository` interface with `getContextWindow(workspaceKey, qualifiedModelId): number | null` and `setContextWindow(workspaceKey, qualifiedModelId, value: number | null): void`. The SQLite implementation SHALL be injected at the handler factory and coordinator constructor — no engine or handler calls `getDb()` for this concern.

#### Scenario: getContextWindow returns override when present
- **WHEN** a row exists in `model_settings` for the given workspace key and model ID
- **THEN** `getContextWindow` returns the stored integer value

#### Scenario: getContextWindow returns null when absent
- **WHEN** no row exists in `model_settings` for the given workspace key and model ID
- **THEN** `getContextWindow` returns `null`

#### Scenario: setContextWindow upserts correctly
- **WHEN** `setContextWindow` is called twice for the same key pair with different values
- **THEN** the second call overwrites the first (no duplicate rows)

### Requirement: models.setContextWindow RPC
The system SHALL expose a `models.setContextWindow` RPC accepting `{ workspaceKey?: string, qualifiedModelId: string, contextWindow: number | null }`. On success it returns an empty object. The handler SHALL delegate to `ModelSettingsRepository.setContextWindow`.

#### Scenario: Setting context window via RPC persists to DB
- **WHEN** the frontend calls `models.setContextWindow` with a valid qualified model ID and positive integer
- **THEN** the value is stored in `model_settings` and subsequent `models.list` calls return the updated `contextWindow`

#### Scenario: Clearing context window via RPC removes override
- **WHEN** the frontend calls `models.setContextWindow` with `contextWindow: null`
- **THEN** the override is removed and `models.list` returns the engine-default context window for that model
