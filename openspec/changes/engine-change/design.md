## Architecture

### Root Cause Flow

```
STARTUP
  workspace.yaml: engine: { type: copilot }
  config.engines = [{ id: 'copilot' }]
  buildEngineInstances() → Map { "copilot" → CopilotEngine }
                              (ClaudeEngine never built)

USER CHANGES ENGINE DROPDOWN (copilot → claude)
  onEngineTypeChange() → loadModelsForEngine()
    → api("models.list", { workspaceKey })
    → orchestrator.listModels(workspaceKey)
    → registry.listAllEngines(workspaceKey)
        → config.engines = [{ id: 'copilot' }]   ← still old config
        → registry.engines.get('copilot') ✓ → [CopilotEngine]
    → CopilotEngine.listModels() → copilot models returned ❌

USER SAVES
  patchWorkspaceYaml({ engine: { type: 'claude' } })
  resetConfig() → cache cleared
  workspaceStore.load() → config refreshed
  watch(config) → syncWsForm()
  loadModelsForEngine() NOT called ❌
  Even if it were:
    registry.listAllEngines → config.engines = [{ id: 'claude' }]
    registry.engines.get('claude') → undefined ❌
    returns [] → model dropdown empty
```

### Fixed Flow

```
STARTUP (fixed)
  config.engines = [{ id: 'copilot' }]   ← from workspace.yaml
  coreFallbacks = [copilot, claude]       ← always-available
  allEngines = mergeWithFallbacks(configEngines, coreFallbacks)
            = [{ id: 'copilot', config: {type:'copilot'} },   ← config-defined (preserved)
               { id: 'claude',  config: {type:'claude'} }]    ← fallback added
  instanceMap = Map { "copilot" → CopilotEngine,
                      "claude"  → ClaudeEngine }   ✓

USER CHANGES ENGINE DROPDOWN (copilot → claude)
  onEngineTypeChange()
    wsForm.engineModel = null
    await loadModelsForEngine("claude")   ← engineType passed
      → api("models.list", { workspaceKey, engineType: "claude" })
      → orchestrator.listModels(workspaceKey, "claude")
          → registry.getEngineById("claude") ✓
          → ClaudeEngine.listModels() → claude models ✓
    model dropdown populated with claude models ✓

USER SAVES
  workspaceStore.update({ engineType: 'claude', engineModel })
  workspaceStore.load() → config refreshed
  await loadModelsForEngine()   ← called after save (no hint — uses config)
    → listAllEngines returns ClaudeEngine (config now says claude) ✓
  model dropdown refreshed ✓
```

## Detailed Changes

### 1. `src/bun/index.ts` — Always build copilot + claude

After collecting config-defined engines, add copilot and claude as fallbacks
if not already present. Config-defined entries take precedence, preserving
any `model:` setting the user may have configured.

```ts
const configEngines: EngineEntry[] = defaultConfig?.engines ?? [];
const configIds = new Set(configEngines.map(e => e.id));
const coreFallbacks: EngineEntry[] = [
  { id: 'copilot', config: { type: 'copilot' } },
  { id: 'claude',  config: { type: 'claude'  } },
];
const allEngines = [
  ...configEngines,
  ...coreFallbacks.filter(e => !configIds.has(e.id)),
];
```

**Why this is safe**: Both engine constructors are pure — no I/O, no auth
checks. Errors only surface on `listModels()` / `execute()`, both of which
already have error handling. A user without Claude Code will see an
informative error in the model dropdown, not a crash.

### 2. `src/shared/rpc-types.ts` — Add `engineType` to `models.list`

```ts
"models.list": {
  params: { workspaceKey?: string; engineType?: string };
  response: ProviderModelList[];
};
```

### 3. `src/bun/engine/coordinator.ts` — Extend `listModels` interface

```ts
listModels(workspaceKey?: string, engineType?: string): Promise<EngineModelInfo[]>;
```

### 4. `src/bun/engine/orchestrator.ts` — Route by engineType when provided

```ts
async listModels(workspaceKey?: string, engineType?: string) {
  const key = workspaceKey ?? getDefaultWorkspaceKey();
  const config = getWorkspaceConfig(key);

  if (engineType) {
    const engine = this.registry.getEngineById(engineType);
    if (!engine) throw new Error(`Engine '${engineType}' is not registered`);
    return runWithConfig(config, () => engine.listModels());
  }

  // existing path: listAllEngines for workspace (unchanged)
  const engines = this.registry.listAllEngines(key);
  const results = await Promise.all(
    engines.map(engine => runWithConfig(config, () => engine.listModels())),
  );
  return results.flat();
}
```

`registry.getEngineById` already exists — no new registry API needed.

### 5. `src/bun/handlers/models.ts` — Forward `engineType`

```ts
"models.list": async (params: { workspaceKey?: string; engineType?: string } = {}) => {
  ...
  const engineModels = await coord.listModels(workspaceKey, params.engineType);
  ...
}
```

### 6. `src/mainview/views/SetupView.vue` — Two-point fix

**Pre-save preview** — pass engine type on dropdown change:
```ts
async function loadModelsForEngine(engineType?: string) {
  ...
  const providerLists = await api("models.list", {
    workspaceKey: workspaceStore.activeWorkspaceKey ?? undefined,
    ...(engineType ? { engineType } : {}),
  });
  ...
}

async function onEngineTypeChange() {
  wsForm.engineModel = null;
  await loadModelsForEngine(wsForm.engineType);  // ← pass new type
}
```

**Post-save refresh** — reload models after saving:
```ts
async function saveWorkspaceSettings() {
  ...
  await workspaceStore.update({ ... });
  await loadModelsForEngine();   // ← refresh after save (no hint; uses config)
  wsSaveSuccess.value = true;
  ...
}
```

## Error Handling

When `engineType` is provided for an engine the user doesn't have available
(e.g., Claude Code not installed):

```
ClaudeEngine.listModels() throws
  → models.list handler catches:
     return [{ id: 'error', models: [], error: "Claude not found" }]
  → Frontend: modelsError.value = "Claude not found"
  → model dropdown shows error message — no crash
```

The existing `models.list` error-catch path handles this with no new code.

## Invariants Preserved

- `EngineRegistry` remains immutable after construction — no mutable methods added
- Default engine routing (for task execution) is still determined by `getDefaultEngine(workspaceKey)` reading the workspace config — unchanged
- `listAllEngines(workspaceKey)` is unchanged — it still respects `allowed_engines` and the workspace config's engine order
- The `engineType` bypass in `orchestrator.listModels` is only used for the Setup UI model preview; task execution never uses it
