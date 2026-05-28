## Why

When the multi-engine support was implemented, `engines.yaml` was mistakenly auto-created inside the workspace config directory (`~/.railyn/workspaces/<key>/`) and the loader checked the workspace dir first. This contradicts the design intent: `engines.yaml` is a global, machine-level file shared across all workspaces, and must live only in the global config directory (`~/.railyn/config/`).

## What Changes

- **`engines.yaml` loading**: The config loader now reads `engines.yaml` exclusively from the global config directory. The workspace-dir fallback (`loadEnginesConfig(configDir) ?? loadEnginesConfig(globalConfigDir)`) is removed.
- **Auto-creation split**: `ensureConfigExists()` is split into two focused functions — `ensureWorkspaceConfigExists()` (workspace.yaml + workflows/) and `ensureGlobalConfigExists()` (engines.yaml) — each targeting the correct directory.
- **`getDefaultConfigDir` renamed** to `getGlobalConfigDir()` for naming clarity; it was misleading as "default" implied workspace scope.
- **`workspace.create` handler** updated to call `ensureWorkspaceConfigExists()` only — creating a new workspace must not touch the global engines file.
- **Silently ignore** workspace-dir `engines.yaml` files; no error, no warning.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `engines-config`: Tighten the loading requirement — `engines.yaml` is loaded exclusively from the global config dir; workspace-dir copies are never read.
- `workspace`: Separate auto-creation requirement — `ensureWorkspaceConfigExists` creates workspace.yaml/workflows, `ensureGlobalConfigExists` creates engines.yaml; `workspace.create` only calls the workspace variant.

## Impact

**Backend:**
- `src/bun/config/index.ts` — rename `getDefaultConfigDir()` → `getGlobalConfigDir()` (private, 2 callsites); split `ensureConfigExists` → two functions; fix `loadEnginesConfig` call in `loadConfig`
- `src/bun/handlers/workspace.ts` — update import and call from `ensureConfigExists` → `ensureWorkspaceConfigExists`

**Tests:** No behavioral changes to existing tests — in test mode `RAILYN_CONFIG_DIR` collapses workspace and global dirs to the same temp path, so engines.yaml placement is unchanged. New integration tests covering dir-separation scenarios are in the companion change `global-engines-config-tests`.

**Config samples:** No changes — `engines.yaml.sample` already lives in `config/` (global dir).
