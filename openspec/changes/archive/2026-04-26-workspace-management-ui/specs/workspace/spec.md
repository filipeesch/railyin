## MODIFIED Requirements

### Requirement: Workspace stores AI provider configuration
Each workspace SHALL store its own engine and AI provider settings in that workspace's `workspace.yaml`. Machine-level `config.yaml` MAY provide shared defaults, but AI executions SHALL use the owning workspace's resolved configuration. Supported workspace engine types SHALL be `copilot` and `claude`. The workspace UI SHALL expose engine type and default model selection without requiring users to edit YAML files directly. The `git_path` and `shell_env_timeout_ms` YAML fields are no longer supported and SHALL be stripped from `workspace.yaml` on the next write operation.

#### Scenario: Different workspaces use different supported engines
- **WHEN** workspace A is configured with `engine.type: copilot` and workspace B is configured with `engine.type: claude`
- **THEN** executions in each workspace use their respective engine configuration

#### Scenario: Global defaults are respected
- **WHEN** `config.yaml` defines a shared default and a workspace does not override it locally
- **THEN** that workspace inherits the global value during config resolution

#### Scenario: Workspace-local override wins
- **WHEN** a workspace defines a value in its own `workspace.yaml` that is also present in `config.yaml`
- **THEN** the workspace-local value is used for that workspace's executions

#### Scenario: Engine type selectable in Setup UI
- **WHEN** the user opens the Workspace tab in Setup view
- **THEN** the engine type field shows "GitHub Copilot" or "Claude Code" and can be changed without editing YAML

#### Scenario: Deprecated fields removed on next write
- **WHEN** a workspace YAML contains `git_path` or `shell_env_timeout_ms` and any setting is saved via the UI
- **THEN** those keys are absent from the resulting YAML file

## REMOVED Requirements

### Requirement: Workspace config is hot-reloaded on demand (label change only — behavior unchanged)
**Reason**: The "Reload config" button is replaced by save-and-reload semantics in the new Workspace settings form. The underlying hot-reload mechanism remains; the manual reload button is removed from the UI.
**Migration**: Users save settings via the form. The backend resets config cache after every `workspace.update` call, providing the same effect.
