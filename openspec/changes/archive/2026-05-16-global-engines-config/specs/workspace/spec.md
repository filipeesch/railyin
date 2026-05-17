## MODIFIED Requirements

### Requirement: Default config files are created on first launch
The system SHALL auto-create workspace-scoped config files (`workspace.yaml`, `workflows/delivery.yaml`) in the workspace config directory when they are absent, so users can start without manual setup. Separately, the system SHALL auto-create `engines.yaml` in the **global config directory** (`~/.railyn/config/`) when it is absent. These two auto-creation concerns MUST be handled by separate functions: `ensureWorkspaceConfigExists(configDir)` for workspace files and `ensureGlobalConfigExists(globalConfigDir)` for the engines file. The `workspace.create` RPC handler SHALL call only `ensureWorkspaceConfigExists` — creating a new workspace MUST NOT write or modify the global engines file.

#### Scenario: Workspace config files created automatically on first launch
- **WHEN** the application starts and the workspace config directory does not contain `workspace.yaml`
- **THEN** `workspace.yaml` and `workflows/delivery.yaml` are created in the workspace config directory with safe defaults

#### Scenario: Global engines.yaml created automatically when absent
- **WHEN** the application starts and `~/.railyn/config/engines.yaml` does not exist
- **THEN** a default `engines.yaml` is created in the global config directory (`~/.railyn/config/`)

#### Scenario: Creating a new workspace does not touch global engines.yaml
- **WHEN** the user creates a new workspace via the `workspace.create` RPC
- **THEN** only workspace-scoped files (`workspace.yaml`, `workflows/`) are created; `engines.yaml` in the global config dir is not modified
