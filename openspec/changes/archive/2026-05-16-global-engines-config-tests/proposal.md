## Why

The `global-engines-config` change fixes where `engines.yaml` is loaded from (global dir only), but existing tests use `RAILYN_CONFIG_DIR` which collapses workspace and global dirs to one path — so they cannot detect regressions in the separation between workspace and global config directories. This companion change adds integration tests that exercise real dir-separation scenarios using the `RAILYN_DATA_DIR` env var pattern, which is already used in the codebase but underexploited.

## What Changes

- **New integration test file** `src/bun/test/global-engines-config.test.ts` — covers 6 separation scenarios using `RAILYN_DATA_DIR` to create production-like dir splits.
- **Extend `workspace-handlers.test.ts`** — add one new assertion to the existing `"creates the default workspace only under the workspaces root"` test (line 74) verifying engines.yaml ends up in the global dir, not the workspace dir.
- **New `workspace.create` integration test** — verify creating a workspace only writes workspace-scoped files, not `engines.yaml`.
- **No production code changes** — all test scenarios are enabled by existing env var DI (`RAILYN_CONFIG_DIR`, `RAILYN_DATA_DIR`, `RAILYN_WORKSPACES_DIR`); no test-only code paths are added.

## Capabilities

### New Capabilities
- `test-global-engines-config`: Integration test suite verifying that `engines.yaml` is loaded exclusively from the global config dir, auto-created in the right dir, and not touched by workspace creation.

### Modified Capabilities
- `test-engines-config`: Extend existing suite to cover the new `ensureWorkspaceConfigExists` and `ensureGlobalConfigExists` function exports.

## Impact

**Tests added:**
- `src/bun/test/global-engines-config.test.ts` (new file, 6 test cases)
- `src/bun/test/workspace-handlers.test.ts` (extend existing test, 1 new test case)

**Production code:** None — no changes to `src/bun/` outside test files.
