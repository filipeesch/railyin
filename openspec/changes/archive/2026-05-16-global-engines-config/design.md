## Context

The config loader in `src/bun/config/index.ts` has two responsibilities that got conflated during the multi-engine implementation:

1. **Workspace config** — `~/.railyn/workspaces/<key>/` — holds `workspace.yaml` and `workflows/`; scoped per-workspace.
2. **Global config** — `~/.railyn/config/` — holds `config.yaml` and `engines.yaml`; machine-level, shared across all workspaces.

`ensureConfigExists(configDir)` currently writes `engines.yaml` into the workspace dir. `loadConfig()` then tries the workspace dir first (`loadEnginesConfig(configDir) ?? loadEnginesConfig(globalConfigDir)`). Both are wrong. The private helper `getDefaultConfigDir()` returns the global config dir but its name implies workspace scope.

In test mode, `RAILYN_CONFIG_DIR` collapses both dirs to the same temp path, masking the bug.

## Goals / Non-Goals

**Goals:**
- `engines.yaml` is read exclusively from `getGlobalConfigDir()` (formerly `getDefaultConfigDir()`)
- Auto-creation of `engines.yaml` targets the global config dir, not the workspace dir
- Naming (`getGlobalConfigDir`, `ensureWorkspaceConfigExists`, `ensureGlobalConfigExists`) makes each function's scope unambiguous
- `workspace.create` creates only workspace-scoped files, never the global engines file
- Zero test-suite impact

**Non-Goals:**
- Migration of existing workspace-dir `engines.yaml` files (silently ignored per decision)
- Changes to the `engines.yaml` format or schema
- Changes to how engines are constructed or registered

## Decisions

### D1 — Rename `getDefaultConfigDir` → `getGlobalConfigDir`
The function returns `~/.railyn/config/` (machine-level global dir). The old name "default" was ambiguous with workspace-default. It is private and only called in 2 places within `config/index.ts`, so the rename is zero-blast-radius outside that file.

### D2 — Split `ensureConfigExists` into two functions
**`ensureWorkspaceConfigExists(configDir)`**: Creates `workspace.yaml` and `workflows/delivery.yaml` in the workspace dir. Called from:
- `loadConfig()` (existing call)
- `workspace.create` handler (existing call, import updated)

**`ensureGlobalConfigExists(globalConfigDir)`**: Creates `engines.yaml` in the global config dir. Called from:
- `loadConfig()` only (new call, after workspace config ensure)

Alternative considered: keep one function with two parameters (`ensureConfigExists(configDir, globalConfigDir)`). Rejected — two responsibilities in one function is a Single Responsibility Principle violation and the function signature becomes confusing.

### D3 — Drop workspace-dir fallback entirely (not deprecate)
The old loading code: `loadEnginesConfig(configDir) ?? loadEnginesConfig(globalConfigDir)`.

New loading code: `loadEnginesConfig(globalConfigDir)` only.

No warning is emitted for workspace-dir `engines.yaml` files. Emitting a warning would require reading the workspace-dir file, which is exactly the behavior we want to stop. Silently ignoring avoids the paradox and keeps startup clean.

### D4 — Test transparency via `RAILYN_CONFIG_DIR`
In test mode, `RAILYN_CONFIG_DIR` is set and `getGlobalConfigDir()` returns it — the same value as the workspace `configDir`. All test helpers that write `engines.yaml` to `configDir` therefore write it to the global config dir in production terms. No test changes required.

## Risks / Trade-offs

- **Silent breakage for workspace-dir users**: Users who placed `engines.yaml` in `~/.railyn/workspaces/default/` (the incorrect location) will see engines fail to load after upgrade. Mitigation: the error message for missing engines.yaml points to `engines.yaml.sample`, which is in the correct global `config/` dir — guiding them to the right location.
- **`workspace.create` no longer creates engines.yaml**: New workspaces won't auto-create a global engines file if one doesn't exist. Mitigation: `loadConfig()` calls `ensureGlobalConfigExists()` which creates the default engines.yaml if absent — so the first `loadConfig()` call at startup covers this.

## Migration Plan

1. Rename `getDefaultConfigDir` → `getGlobalConfigDir` (no observable behavior change).
2. Split `ensureConfigExists` → `ensureWorkspaceConfigExists` + `ensureGlobalConfigExists`.
3. Update `loadConfig()` to call both ensures and only read from global dir.
4. Update `handlers/workspace.ts` import + callsite.
5. Verify existing tests pass without modification.
