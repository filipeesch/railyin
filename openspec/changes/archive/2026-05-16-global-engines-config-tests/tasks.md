## 1. New test file — dir-separation integration tests

- [x] 1.1 Create `src/bun/test/global-engines-config.test.ts` with a shared helper `makeDataDirEnv()` that creates a temp `dataDir`, sets `RAILYN_DATA_DIR`, deletes `RAILYN_CONFIG_DIR`, and returns paths for `workspaceDir = join(dataDir,"workspaces/default")` and `globalConfigDir = join(dataDir,"config")` plus a cleanup function
- [x] 1.2 Write test GEC-1: write engines.yaml to `globalConfigDir` only → `loadConfig()` succeeds and engines are loaded
- [x] 1.3 Write test GEC-2: write engines.yaml to `workspaceDir` only (global dir absent) → workspace engines are silently ignored (global auto-created with defaults)
- [x] 1.4 Write test GEC-3: engines.yaml in both dirs with different engine lists → `config.engines` matches global dir content only
- [x] 1.5 Write test GEC-4: call `ensureWorkspaceConfigExists(tempDir)` → `tempDir/workspace.test.yaml` and `tempDir/workflows/delivery.yaml` exist, `tempDir/engines.yaml` does NOT exist
- [x] 1.6 Write test GEC-5: call `ensureGlobalConfigExists(tempDir)` → `tempDir/engines.yaml` exists, no `workspace.yaml` or `workflows/` in `tempDir`
- [x] 1.7 Write test GEC-6: call `loadConfig()` with `RAILYN_DATA_DIR` set, empty dirs → `dataDir/config/engines.yaml` exists, `dataDir/workspaces/default/engines.yaml` does NOT exist

## 2. Extend workspace-handlers.test.ts

- [x] 2.1 Add test GEC-EXT-1 as a new `it` block after the existing `"creates the default workspace only under the workspaces root"` test: using the same `RAILYN_DATA_DIR` pattern, assert `dataDir/config/engines.yaml` exists and `dataDir/workspaces/default/engines.yaml` does NOT exist after `loadConfig()`
- [x] 2.2 Add test GEC-7: set `RAILYN_WORKSPACES_DIR` to a fresh temp dir, call `workspaceHandlers(db)["workspace.create"]({ name: "new-ws" })`, assert the new workspace dir contains `workspace.test.yaml` (or `workspace.yaml`) and does NOT contain `engines.yaml`

## 3. Run and verify

- [x] 3.1 Run `bun test src/bun/test/global-engines-config.test.ts --timeout 20000` — all 6 tests green
- [x] 3.2 Run `bun test src/bun/test/workspace-handlers.test.ts --timeout 20000` — all existing + 2 new tests green (13 total)
- [x] 3.3 Run `bun test src/bun/test --timeout 20000` — full suite green with no regressions (1225 pass)
