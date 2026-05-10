## ADDED Requirements

### Requirement: Workspace declares its default model via default_model
Each workspace's `workspace.yaml` SHALL declare its default model as a single fully-qualified string in the `default_model` field, formatted `<engineId>/<modelId>` (e.g. `copilot/claude-sonnet-4.6`). The engine for that model SHALL be derived from the prefix; no separate engine type field is required. The `default_model` field MAY be omitted, in which case the workspace has no preferred default and the first engine declared in `engines.yaml` provides the default model when one is needed.

#### Scenario: default_model selects the workspace default
- **WHEN** `workspace.yaml` declares `default_model: copilot/claude-sonnet-4.6` and a new conversation is created without an explicit model
- **THEN** the conversation's model is set to `copilot/claude-sonnet-4.6` and the corresponding engine handles the execution

#### Scenario: Engine derived from default_model prefix
- **WHEN** `default_model: claude/claude-sonnet-4.6` is set
- **THEN** the workspace resolves `claude` as the active engine for that conversation by parsing the prefix, with no `engine.type` field present anywhere

#### Scenario: default_model absent — first engine provides the default
- **WHEN** `workspace.yaml` declares no `default_model` and `engines.yaml` lists copilot first
- **THEN** new conversations without a model fall back to the first engine's configured model (or no model when the engine has none configured)

#### Scenario: workspace.update writes default_model directly
- **WHEN** the user picks a model in the Setup UI
- **THEN** the `workspace.update` RPC writes `default_model: <selected qualified id>` to `workspace.yaml` without composing an `engine:` block

## MODIFIED Requirements

### Requirement: Workspace stores AI provider configuration
Each workspace SHALL store its own engine and AI provider settings via `engines.yaml` (engine instance declarations, shared across workspaces) and the workspace-local `workspace.yaml` (workspace-scoped policy: `allowed_engines` filter, `default_model`, provider credentials). Machine-level `config.yaml` MAY provide shared defaults. The workspace UI SHALL expose default model selection without requiring users to edit YAML files directly. The `git_path` and `shell_env_timeout_ms` YAML fields are no longer supported and SHALL be stripped from `workspace.yaml` on the next write operation. The `engine:` block in `workspace.yaml` SHALL no longer be accepted; the loader SHALL return a configuration error when it is present.

#### Scenario: Different workspaces can prefer different default models
- **WHEN** workspace A declares `default_model: copilot/gpt-4.1` and workspace B declares `default_model: claude/claude-sonnet-4.6`
- **THEN** new conversations in each workspace are seeded with the workspace's preferred model and routed to the corresponding engine

#### Scenario: Global defaults are respected
- **WHEN** `config.yaml` defines a shared default and a workspace does not override it locally
- **THEN** that workspace inherits the global value during config resolution

#### Scenario: Workspace-local override wins
- **WHEN** a workspace defines a value in its own `workspace.yaml` that is also present in `config.yaml`
- **THEN** the workspace-local value is used for that workspace's executions

#### Scenario: Default model selectable in Setup UI
- **WHEN** the user opens the Workspace tab in Setup view
- **THEN** the "Default model" picker shows enabled qualified models and saving writes `default_model: <selected id>` to `workspace.yaml`

#### Scenario: Deprecated fields removed on next write
- **WHEN** a workspace YAML contains `git_path` or `shell_env_timeout_ms` and any setting is saved via the UI
- **THEN** those keys are absent from the resulting YAML file

#### Scenario: Legacy engine: block errors at startup
- **WHEN** `workspace.yaml` contains an `engine:` block
- **THEN** the loader returns a configuration error explaining the migration to `default_model` and refuses to start

### Requirement: Workspace configuration supports optional allowed_engines filter
The workspace YAML schema SHALL support an optional `allowed_engines` field containing a list of engine IDs. When present, only the listed engines (as declared in `engines.yaml`) SHALL be available for that workspace. When absent, all engines from `engines.yaml` are available.

#### Scenario: allowed_engines restricts model picker
- **WHEN** a workspace declares `allowed_engines: [copilot]`
- **THEN** only copilot models appear in that workspace's model picker

#### Scenario: No allowed_engines means all engines available
- **WHEN** a workspace has no `allowed_engines` field
- **THEN** all engines from `engines.yaml` are available in that workspace

## REMOVED Requirements

### Requirement: ~~engine: block in workspace.yaml supersedes engines.yaml fallback~~
**Reason**: The `engine:` block was the legacy single-engine config. With `engines.yaml` now mandatory and `default_model` carrying the workspace default, the block has no remaining responsibilities. Keeping it would preserve a parallel resolution path that the rest of this change deletes.
**Migration**: Replace
```yaml
engine:
  type: copilot
  model: claude-sonnet-4.6
```
with
```yaml
default_model: copilot/claude-sonnet-4.6
```
and ensure `config/engines.yaml` declares the engines you want available (see `config/engines.yaml.sample`).
