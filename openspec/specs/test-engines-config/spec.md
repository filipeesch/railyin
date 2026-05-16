# Spec: test-engines-config

## Purpose

Specifies how `engines.yaml` is loaded, validated, and how it interacts with the legacy `engine:` block in `workspace.yaml`, including `allowed_engines` filtering and startup-time validation.

## Requirements

### Requirement: EC-engines-yaml-load
`loadEnginesConfig()` parses `engines.yaml` from `RAILYN_CONFIG_DIR`.

#### Scenario: EC-1 three engines loaded
- **WHEN** `engines.yaml` defines copilot, claude, opencode entries
- **THEN** `LoadedConfig.engines` has 3 items with correct id, type, model fields

#### Scenario: EC-2 first engine is default
- **WHEN** `engines.yaml` defines two engines
- **THEN** `getDefaultEngine(workspaceKey)` returns the first entry

---

### Requirement: EC-backward-compat
Absent `engines.yaml` falls back to `engine:` block in `workspace.yaml`.

#### Scenario: EC-3 fallback to workspace.yaml engine block
- **WHEN** `engines.yaml` does not exist but `workspace.yaml` has `engine: { type: copilot, model: gpt-4.1 }`
- **THEN** `LoadedConfig.engines` has exactly one entry matching the workspace engine block

#### Scenario: EC-4 both files present — engines.yaml wins, warning logged
- **WHEN** both `engines.yaml` and `workspace.yaml` have engine config
- **THEN** `engines.yaml` takes precedence and a warning is logged at startup

---

### Requirement: EC-allowed-engines
`allowed_engines` in `workspace.yaml` filters visible engines per workspace.

#### Scenario: EC-5 single allowed engine ID
- **WHEN** `workspace.yaml` has `allowed_engines: [copilot]` and `engines.yaml` has copilot + claude
- **THEN** `listAllEngines(workspaceKey)` returns only the copilot engine

#### Scenario: EC-6 no allowed_engines means all
- **WHEN** `workspace.yaml` has no `allowed_engines` key
- **THEN** `listAllEngines(workspaceKey)` returns all engines from `engines.yaml`

---

### Requirement: EC-validation
Invalid `engines.yaml` content fails at load time with clear errors.

#### Scenario: EC-7 unknown id in allowed_engines skipped with warning
- **WHEN** `workspace.yaml` has `allowed_engines: [copilot, nonexistent]`
- **THEN** `nonexistent` is silently skipped, a warning is logged, copilot is still available

#### Scenario: EC-8 zero engine entries throws
- **WHEN** `engines.yaml` has `engines: []`
- **THEN** startup throws with a message indicating at least one engine is required

---

### Requirement: Existing workspace-handlers test extended with global-dir placement assertion
The existing test `"creates the default workspace only under the workspaces root"` in `workspace-handlers.test.ts` SHALL be complemented by a new assertion or sibling test that verifies engines.yaml placement after `loadConfig()` with `RAILYN_DATA_DIR` set: engines.yaml appears in the global config dir and not in the workspace dir.

#### Scenario: GEC-EXT-1 — loadConfig with RAILYN_DATA_DIR places engines.yaml in global dir
- **WHEN** `loadConfig()` is called with `RAILYN_DATA_DIR` set and `RAILYN_CONFIG_DIR` absent
- **THEN** `dataDir/config/engines.yaml` exists
- **AND** `dataDir/workspaces/default/engines.yaml` does NOT exist
