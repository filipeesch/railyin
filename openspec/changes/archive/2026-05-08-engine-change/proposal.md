## Why

When a user switches from copilot to claude (or vice versa) in the Setup view at runtime, the default model dropdown fails to update. The workaround requires manually editing `workspace.yaml` and restarting the app. This breaks a key setup flow and forces users out of the UI for a routine configuration change.

Two independent bugs cause this:

1. **Static engine registry**: `EngineRegistry` is built once at startup from `config.engines`. A workspace configured with `engine: {type: copilot}` only creates a `CopilotEngine` — no `ClaudeEngine` instance exists to switch to. When `models.list` is called for the new engine, the registry has no matching instance and returns empty or wrong models.

2. **Missing model refresh**: After saving a new engine type, `loadModelsForEngine()` is never called in the save path, so the model dropdown stays stale even after the config is correctly persisted.

## What Changes

- **`src/bun/index.ts`**: Always ensure `copilot` and `claude` engine instances are built at startup regardless of what `workspace.yaml` declares. These engines require no extra credentials from config (copilot uses GH token from env, claude uses the local Claude Code session). Config-defined entries take precedence and preserve any `model:` setting.

- **`src/bun/engine/coordinator.ts`**: Extend `listModels` interface with optional `engineType` parameter to support direct per-engine queries.

- **`src/bun/engine/orchestrator.ts`**: When `engineType` is provided, bypass the workspace-filtered `listAllEngines` path and directly look up the engine by ID via `registry.getEngineById`.

- **`src/bun/handlers/models.ts`**: Forward the optional `engineType` parameter from the RPC call to `coord.listModels`.

- **`src/shared/rpc-types.ts`**: Add `engineType?: string` to `models.list` params.

- **`src/mainview/views/SetupView.vue`**: Pass the selected engine type to `models.list` when the dropdown changes (pre-save preview), and call `loadModelsForEngine()` after saving to refresh the dropdown.

## Capabilities

### Modified Capabilities

- `model-selection`: The `models.list` RPC now accepts an optional `engineType` parameter. When provided, it returns models from that specific engine regardless of the current workspace config — enabling pre-save model previews.

- `workspace-management`: The Setup view now correctly refreshes the default model dropdown immediately when the engine type dropdown changes, and again after saving. Engine switching is a fully runtime operation — no restart required.

- `engine-registry-behavior`: `EngineRegistry` always contains both `copilot` and `claude` engine instances after startup, regardless of workspace configuration. These are treated as always-available core engines. If either engine is unavailable at runtime (e.g., Claude Code not installed), `listModels()` returns an error entry — the registry construction itself never fails.

## Non-Goals

- Making `engineOptions` in SetupView dynamic (driven by the backend registry)
- Fixing the `resetConfig()` call on every `workspace.getConfig` request
- Supporting runtime engine switching for opencode or pi (still require restart when credentials change)

## Impact

- **Changed files**: 6
- **New files**: 0
- **Breaking changes**: None — `engineType` is optional; existing callers unaffected
- **Test impact**: Existing backend tests and Playwright specs are unaffected; new scenarios should be added for the runtime engine-switch flow (deferred to a follow-up change)
