## ADDED Requirements

### Requirement: Existing workspace-handlers test extended with global-dir placement assertion
The existing test `"creates the default workspace only under the workspaces root"` in `workspace-handlers.test.ts` SHALL be complemented by a new assertion or sibling test that verifies engines.yaml placement after `loadConfig()` with `RAILYN_DATA_DIR` set: engines.yaml appears in the global config dir and not in the workspace dir.

#### Scenario: GEC-EXT-1 — loadConfig with RAILYN_DATA_DIR places engines.yaml in global dir
- **WHEN** `loadConfig()` is called with `RAILYN_DATA_DIR` set and `RAILYN_CONFIG_DIR` absent
- **THEN** `dataDir/config/engines.yaml` exists
- **AND** `dataDir/workspaces/default/engines.yaml` does NOT exist
