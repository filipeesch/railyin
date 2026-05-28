# Spec: test-global-engines-config

## Purpose

TBD — Specifies integration tests that validate engines.yaml loading and placement under a production-like directory split where RAILYN_DATA_DIR is used (without RAILYN_CONFIG_DIR), so the workspace config dir and global config dir are distinct paths.

## Requirements

### Requirement: engines.yaml loaded from global dir in production-layout integration tests
The test suite SHALL include integration tests that use `RAILYN_DATA_DIR` (without `RAILYN_CONFIG_DIR`) to create a production-like directory split where the workspace config dir and global config dir are distinct paths. These tests SHALL verify all loading, auto-creation, and workspace-creation behaviors with real dir separation.

#### Scenario: GEC-1 — engines.yaml in global dir only loads correctly
- **WHEN** `engines.yaml` exists in `dataDir/config/` and the workspace dir `dataDir/workspaces/default/` has no `engines.yaml`
- **THEN** `loadConfig()` returns no error and `config.engines` contains the declared engines

#### Scenario: GEC-2 — engines.yaml in workspace dir only causes a config error
- **WHEN** `engines.yaml` exists only in `dataDir/workspaces/default/` (workspace dir) and `dataDir/config/` has no `engines.yaml`
- **THEN** `loadConfig()` returns a non-null error indicating engines.yaml is missing or not found

#### Scenario: GEC-3 — engines.yaml in both dirs: global dir wins
- **WHEN** `dataDir/config/engines.yaml` declares `[copilot, claude]` and `dataDir/workspaces/default/engines.yaml` declares `[opencode]`
- **THEN** `config.engines` contains exactly `[copilot, claude]` — the workspace-dir copy is silently ignored

#### Scenario: GEC-4 — ensureWorkspaceConfigExists does not create engines.yaml
- **WHEN** `ensureWorkspaceConfigExists(tempDir)` is called on an empty directory
- **THEN** `tempDir/workspace.yaml` (or `workspace.test.yaml`) and `tempDir/workflows/delivery.yaml` exist
- **AND** `tempDir/engines.yaml` does NOT exist

#### Scenario: GEC-5 — ensureGlobalConfigExists creates engines.yaml in the target dir
- **WHEN** `ensureGlobalConfigExists(tempDir)` is called on an empty directory
- **THEN** `tempDir/engines.yaml` exists and contains at least one engine entry
- **AND** no `workspace.yaml` or `workflows/` are created in `tempDir`

#### Scenario: GEC-6 — loadConfig auto-creates engines.yaml in global dir not workspace dir
- **WHEN** `RAILYN_DATA_DIR` is set to an empty temp dir and `loadConfig()` is called for the first time
- **THEN** `dataDir/config/engines.yaml` exists after the call
- **AND** `dataDir/workspaces/default/engines.yaml` does NOT exist

---

### Requirement: workspace.create does not write engines.yaml
The test suite SHALL include an integration test verifying that the `workspace.create` RPC handler creates only workspace-scoped files (`workspace.yaml`, `workflows/delivery.yaml`) and does not create `engines.yaml` anywhere in the new workspace directory.

#### Scenario: GEC-7 — workspace.create produces workspace files but not engines.yaml
- **WHEN** `workspaceHandlers(db)["workspace.create"]({ name: "new-ws" })` is called with `RAILYN_WORKSPACES_DIR` pointing to a temp dir
- **THEN** a `workspace.yaml` (or `workspace.test.yaml`) exists in the new workspace dir
- **AND** `engines.yaml` does NOT exist in the new workspace dir
