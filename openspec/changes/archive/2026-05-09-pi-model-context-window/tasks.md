## 1. DB Migration

- [x] 1.1 Create `src/bun/db/migrations/043_model_settings.ts` with `CREATE TABLE IF NOT EXISTS model_settings (workspace_key TEXT NOT NULL, qualified_model_id TEXT NOT NULL, context_window INTEGER, PRIMARY KEY (workspace_key, qualified_model_id))`
- [x] 1.2 Register the migration in `src/bun/db/migrations.ts` (import + add to migration array)

## 2. ModelSettingsRepository

- [x] 2.1 Create `src/bun/db/repositories/model-settings-repository.ts` with exported `ModelSettingsRepository` interface (`getContextWindow`, `setContextWindow`) and `SqliteModelSettingsRepository` class implementing it
- [x] 2.2 Export `ModelSettingsRepository` and `SqliteModelSettingsRepository` from `src/bun/db/index.ts` (or wherever DB exports live)

## 3. RPC Types

- [x] 3.1 Add `contextWindowEditable?: boolean` to `ProviderModelList.models[]` item type in `src/shared/rpc-types.ts`
- [x] 3.2 Add `models.setContextWindow` RPC entry to `src/shared/rpc-types.ts` with request `{ workspaceKey?: string; qualifiedModelId: string; contextWindow: number | null }` and response `{}`

## 4. Engine Types

- [x] 4.1 Add `contextWindowOverride?: number` to `ExecutionParams` in `src/bun/engine/types.ts`
- [x] 4.2 Add `contextWindowEditable?: boolean` to `EngineModelInfo` in `src/bun/engine/types.ts`

## 5. Pi Engine

- [x] 5.1 Fix `/models` → `/v1/models` URL in Pi engine's provider model fetching (bug fix, part of this change)
- [x] 5.2 Set `contextWindowEditable: true` on every `EngineModelInfo` returned from `listModels()` in `src/bun/engine/pi/engine.ts`
- [x] 5.3 Update `buildModel()` in `src/bun/engine/pi/engine.ts` to use `params.contextWindowOverride ?? this.config.context_window ?? DEFAULT_CONTEXT_WINDOW`

## 6. Backend Handler

- [x] 6.1 Update `modelHandlers` factory signature in `src/bun/handlers/models.ts` to accept `modelSettingsRepo: ModelSettingsRepository`
- [x] 6.2 In `models.list` handler, JOIN / cross-reference `model_settings` overrides to apply the precedence (DB override → server-reported → null) and pass `contextWindowEditable` through from engine's `listModels()` response
- [x] 6.3 Add `models.setContextWindow` handler in `src/bun/handlers/models.ts` delegating to `modelSettingsRepo.setContextWindow`

## 7. Orchestrator

- [x] 7.1 Add `modelSettingsRepo: ModelSettingsRepository` to orchestrator constructor in `src/bun/engine/orchestrator.ts`
- [x] 7.2 Before calling `engine.execute()`, resolve `modelSettingsRepo.getContextWindow(workspaceKey, qualifiedModelId)` and include result as `contextWindowOverride` in `ExecutionParams`

## 8. Wiring

- [x] 8.1 Instantiate `SqliteModelSettingsRepository` in `src/bun/index.ts` and inject into the orchestrator constructor and `modelHandlers` factory
- [x] 8.2 Pass `modelSettingsRepo` into handler registration (wherever `modelHandlers(db, orchestrator)` is called)

## 9. Frontend Store

- [x] 9.1 Add `setModelContextWindow(qualifiedModelId: string, contextWindow: number | null, workspaceKey?: string)` action to `src/mainview/stores/workspace.ts` that calls `rpc('models.setContextWindow', { qualifiedModelId, contextWindow, workspaceKey })`
- [x] 9.2 Ensure `loadAllModels()` re-fetches after a successful `setModelContextWindow` call (or the model list reflects the update reactively)

## 10. Frontend UI

- [x] 10.1 In `src/mainview/components/ModelTreeView.vue`, conditionally render a pencil icon (visible on row hover) for models where `contextWindowEditable === true`
- [x] 10.2 Add inline edit state: clicking the badge or pencil icon on an editable row enters an `InputNumber` edit mode in place of the static badge
- [x] 10.3 On blur or Enter, call `setModelContextWindow` with the new value; on Escape, cancel without saving
- [x] 10.4 Show a tooltip/hint on the InputNumber: "Set to match your server's loaded context size"
- [x] 10.5 On null (empty/cleared) input confirmed, call `setModelContextWindow` with `null` to revert to engine default
