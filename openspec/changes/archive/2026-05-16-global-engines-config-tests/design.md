## Context

The production codebase already has two env-var-based DI mechanisms for the config system:

| Env var | Effect |
|---|---|
| `RAILYN_CONFIG_DIR` | Makes `configDir` and `getGlobalConfigDir()` return the **same** temp path. Used by most existing tests. Cannot distinguish workspace from global dir. |
| `RAILYN_DATA_DIR` | Sets the root; workspace dir = `join(dataDir,"workspaces/default")`, global dir = `join(dataDir,"config")`. **Separate paths.** Already used in `workspace-handlers.test.ts:74`. |
| `RAILYN_WORKSPACES_DIR` | Override for where `workspace.create` writes new workspace dirs. Isolates workspace creation tests. |

`ensureWorkspaceConfigExists` and `ensureGlobalConfigExists` are exported functions — directly callable in tests without mocking.

No code changes are needed to enable separation testing; the env var infrastructure already provides it.

## Goals / Non-Goals

**Goals:**
- Cover the 6 new scenarios from the `engines-config` delta spec (especially "workspace-dir engines.yaml silently ignored")
- Verify `ensureWorkspaceConfigExists` creates no `engines.yaml`
- Verify `ensureGlobalConfigExists` creates `engines.yaml` in the global dir
- Verify `workspace.create` leaves the global `engines.yaml` untouched
- Extend the existing line-74 test with the global-dir assertion

**Non-Goals:**
- Playwright/UI tests (feature is entirely backend/config)
- Changing existing EC-* tests (they remain valid as-is under `RAILYN_CONFIG_DIR`)
- Testing the `engines.yaml` schema or engine construction (already covered by EC-*)

## Decisions

### D1 — Use `RAILYN_DATA_DIR` pattern for separation tests
The `RAILYN_DATA_DIR` env var creates a real workspace/global split in one temp dir, matching production layout. All 6 new test cases use this pattern.

Each test:
1. Creates a `dataDir = mkdtempSync(…)`
2. Sets `RAILYN_DATA_DIR = dataDir`, deletes `RAILYN_CONFIG_DIR`
3. Writes fixture files to the correct subdirs (`dataDir/workspaces/default/` or `dataDir/config/`)
4. Calls `resetConfig()` then `loadConfig()` (or calls the ensure-functions directly)
5. Asserts file presence/absence with `existsSync`
6. Cleans up: `rmSync(dataDir, …)`, delete env vars, `resetConfig()`

### D2 — Direct function calls for ensure-function unit tests
`ensureWorkspaceConfigExists(dir)` and `ensureGlobalConfigExists(dir)` are exported, so tests call them directly with a fresh `mkdtempSync` dir and assert file presence via `existsSync`. No env vars needed for these two tests — they're pure filesystem calls.

### D3 — `RAILYN_WORKSPACES_DIR` for workspace.create isolation
`workspace.create` computes the new workspace path from `RAILYN_WORKSPACES_DIR ?? join(getDataDir(),"workspaces")`. Setting `RAILYN_WORKSPACES_DIR` to a temp dir lets the test verify what's created without touching `~/.railyn`.

### D4 — Extend line-74 test rather than duplicate it
The existing test at `workspace-handlers.test.ts:74` already sets up the `RAILYN_DATA_DIR` environment. Add one new `it` block immediately after it that adds the `engines.yaml` placement assertion rather than duplicating the setup.

## Risks / Trade-offs

- **`__RAILYN_DEV_CONFIG_DIR__` compile-time constant**: In Vite dev builds this is baked in, but `bun test` runs TypeScript directly without Vite's `--define`, so `typeof __RAILYN_DEV_CONFIG_DIR__ === "undefined"` in all tests. The `RAILYN_DATA_DIR` pattern works correctly.
- **Test isolation**: Each test must clean up env vars and call `resetConfig()` in `afterEach`. Failure to do so leaks state. Follow the pattern in `workspace-handlers.test.ts:74` exactly.
