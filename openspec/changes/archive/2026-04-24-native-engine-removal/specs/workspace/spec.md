## MODIFIED Requirements

### Requirement: Workspace stores AI provider configuration
Each workspace SHALL store its own engine and AI provider settings in that workspace's `workspace.yaml`. Machine-level `config.yaml` MAY provide shared defaults, but AI executions SHALL use the owning workspace's resolved configuration. Supported workspace engine types SHALL be `copilot` and `claude`.

#### Scenario: Different workspaces use different supported engines
- **WHEN** workspace A is configured with `engine.type: copilot` and workspace B is configured with `engine.type: claude`
- **THEN** executions in each workspace use their respective engine configuration

#### Scenario: Global defaults are respected
- **WHEN** `config.yaml` defines a shared default such as `git_path` and a workspace does not override it locally
- **THEN** that workspace inherits the global value during config resolution

#### Scenario: Workspace-local override wins
- **WHEN** a workspace defines a value in its own `workspace.yaml` that is also present in `config.yaml`
- **THEN** the workspace-local value is used for that workspace's executions

