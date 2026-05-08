## Tasks

- [x] **Always register copilot+claude as core engine fallbacks at startup**
  - In `src/bun/index.ts`, after collecting `configEngines` from `defaultConfig.engines`, define `coreFallbacks` with `{ id: 'copilot', config: { type: 'copilot' } }` and `{ id: 'claude', config: { type: 'claude' } }`
  - Merge them into `allEngines` filtering out IDs already present in `configEngines`
  - Pass the merged list to `buildEngineInstances` (the variable is `uniqueEngines` in the current code — update accordingly)
  - Verify both engine instances appear in the registry map

- [x] **Extend `models.list` RPC with optional `engineType` parameter**
  - `src/shared/rpc-types.ts`: add `engineType?: string` to `models.list` params
  - `src/bun/engine/coordinator.ts`: update `listModels` signature to `listModels(workspaceKey?: string, engineType?: string): Promise<EngineModelInfo[]>`
  - `src/bun/engine/orchestrator.ts`: in `listModels`, when `engineType` is provided call `registry.getEngineById(engineType)` and run its `listModels()` directly (wrapped in `runWithConfig`); throw if not found; fall through to existing path when absent
  - `src/bun/handlers/models.ts`: update params type to include `engineType?: string` and pass it to `coord.listModels(workspaceKey, params.engineType)`

- [x] **Fix SetupView model dropdown: pass engineType on change, reload after save**
  - `src/mainview/views/SetupView.vue`:
    - Add optional `engineType?: string` parameter to `loadModelsForEngine()`; forward it to `api("models.list", { workspaceKey, ...(engineType ? { engineType } : {}) })`
    - In `onEngineTypeChange()`: pass `wsForm.engineType` to `loadModelsForEngine(wsForm.engineType)` so the dropdown immediately shows models for the newly selected engine
    - In `saveWorkspaceSettings()`: after `await workspaceStore.update(...)` succeeds, call `await loadModelsForEngine()` (no hint — refreshes using the now-saved config)
