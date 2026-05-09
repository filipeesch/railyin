## Why

Pi and OpenCode engine models display a static context window badge in the Models setup screen, but that value is either a hardcoded default (128K) or whatever the server happened to report — neither of which reflects the actual runtime context size the user has configured on their local LLM server. There is no way to correct it without editing `workspace.yaml` directly, and even then the setting is coarse (one value for the entire engine, not per model). Users running Ollama with a custom `num_ctx` or LM Studio with a non-default context size have no way to tell Railyin the real number, which means compaction fires at the wrong threshold.

## What Changes

- **New DB table `model_settings`**: Stores per-model user overrides keyed by `(workspace_key, qualified_model_id)`. Starts with `context_window INTEGER` column. A new migration (`043_model_settings.ts`) creates it.

- **New `ModelSettingsRepository` interface + SQLite implementation**: Encapsulates all reads and writes to `model_settings`. Injected via DI — no engine or handler calls `getDb()` directly for this concern.

- **New RPC `models.setContextWindow`**: Accepts `{ workspaceKey?, qualifiedModelId, contextWindow: number | null }`. Writes to `model_settings` via the repository. `null` clears the override (reverts to engine default).

- **`models.list` enriched**: Each model row gains `contextWindowEditable?: boolean` (true for Pi and OpenCode engines). The `contextWindow` value returned now reflects: user override → server-reported → engine default, in that precedence order.

- **`ExecutionParams` gains `contextWindowOverride?: number`**: The orchestrator resolves the effective context window from `ModelSettingsRepository` before calling `engine.execute()` and passes it in. Pi engine's `buildModel()` reads from params — no DB access inside the engine.

- **`ModelTreeView.vue` updated**: Pi/OpenCode model rows show an edit icon next to the context window badge. Clicking enters an inline `InputNumber` edit mode; blur or Enter saves via `models.setContextWindow`. Copilot/Claude rows remain static badges.

## Capabilities

### New Capabilities

- `model-context-window-settings`: Per-model context window override stored in the database, exposed via RPC, and applied at execution time. Covers the repository interface, migration, RPC contract, and UI interaction.

### Modified Capabilities

- `model-selection`: `models.list` response gains `contextWindowEditable` flag and the `contextWindow` field now reflects the user override when present.
- `pi-engine`: `buildModel()` reads context window from `ExecutionParams.contextWindowOverride` instead of `this.config.context_window` alone, aligning with the DI pattern already established by `boardTools`.

## Impact

- **New files**: `src/bun/db/migrations/043_model_settings.ts`, `src/bun/db/repositories/model-settings-repository.ts`
- **Changed files**: `src/shared/rpc-types.ts`, `src/bun/handlers/models.ts`, `src/bun/engine/types.ts`, `src/bun/engine/pi/engine.ts`, `src/bun/engine/orchestrator.ts`, `src/mainview/components/ModelTreeView.vue`, `src/mainview/stores/workspace.ts`
- **Breaking changes**: None — `contextWindowEditable` and `contextWindowOverride` are new optional fields; existing callers unaffected
- **Test impact**: New unit tests for `ModelSettingsRepository`; existing Pi engine and model handler tests require minor updates for the new `ExecutionParams` field
