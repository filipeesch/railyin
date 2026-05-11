## Purpose
The workspace is the top-level container for boards, projects, workflow templates, and AI/provider execution configuration. Installations may contain multiple local workspaces.

## Requirements

### Requirement: Workspace is the top-level container
The system SHALL maintain one or more workspaces per installation. Each workspace acts as the root container for its own boards, projects, workflow templates, and workspace-local AI configuration. The UI SHALL allow one workspace to be active at a time without deleting or merging the others.

#### Scenario: Default workspace synthesized for legacy installs
- **WHEN** the application starts before any workspace folders exist under `~/.railyin/workspaces/`
- **THEN** the system creates or resolves one default workspace from the legacy single-workspace configuration

#### Scenario: Multiple workspaces loaded from folders
- **WHEN** multiple workspace folders exist under `~/.railyin/workspaces/`
- **THEN** the application loads those workspaces as separate top-level containers

#### Scenario: Switching active workspace preserves other workspaces
- **WHEN** the user switches from one workspace to another
- **THEN** boards, projects, and task history in the non-active workspace remain unchanged and available when revisited

### Requirement: Workspace and project definitions are file-backed
The system SHALL store workspaces as folders under `~/.railyin/workspaces/`. Each workspace folder SHALL contain a `workspace.yaml` file that stores workspace metadata, engine config, and the project list for that workspace.

#### Scenario: Workspace discovered from folder structure
- **WHEN** a folder exists at `~/.railyin/workspaces/work/`
- **THEN** the application treats `work` as a workspace key and loads its `workspace.yaml`

#### Scenario: Projects loaded from workspace file
- **WHEN** a workspace's `workspace.yaml` contains multiple project entries
- **THEN** those projects are loaded as belonging only to that workspace

#### Scenario: Workspace/project rows are not source of truth
- **WHEN** the app resolves workspace or project definitions
- **THEN** it does not depend on SQLite `workspaces` or `projects` rows as the authoritative source

### Requirement: Workflows are local to a workspace
The system SHALL resolve workflow templates from the owning workspace's `workflows/` directory. Workflow definitions are not shared globally across workspaces.

#### Scenario: Same workflow id in two workspaces stays isolated
- **WHEN** workspace A and workspace B both define `delivery.yaml`
- **THEN** each workspace resolves its own local `delivery` workflow definition

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

### Requirement: Workspace schema includes workspace_key for board and model association
The database schema SHALL store `workspace_key TEXT` (the file-derived string key, e.g. `"default"`) on `boards` and `enabled_models` instead of a hash-derived integer `workspace_id`. The key directly identifies the owning workspace without indirection.

#### Scenario: Board row carries workspace_key
- **WHEN** a board is created or queried
- **THEN** the `workspace_key` column contains the string key of the owning workspace (e.g. `"default"`)

#### Scenario: Enabled model row carries workspace_key
- **WHEN** model preferences are stored or queried for a workspace
- **THEN** the `workspace_key` column identifies the owning workspace

#### Scenario: No hash-derived integer needed
- **WHEN** the runtime resolves which workspace a board belongs to
- **THEN** it reads `workspace_key` directly without reversing a numeric hash

### Requirement: Default config files are created on first launch
The system SHALL auto-create `workspace.yaml` and the default workflow YAML when the config directory does not exist, so users can start without manual setup.

#### Scenario: Config directory created automatically
- **WHEN** the application starts and `~/.railyn/config/` does not exist
- **THEN** the directory and default config files are created with safe defaults (`provider: fake`)

### Requirement: Workspace configuration supports optional allowed_engines filter
The workspace YAML schema SHALL support an optional `allowed_engines` field containing a list of engine IDs. When present, only the listed engines (as declared in `engines.yaml`) SHALL be available for that workspace. When absent, all engines from `engines.yaml` are available.

#### Scenario: allowed_engines restricts model picker
- **WHEN** a workspace declares `allowed_engines: [copilot]`
- **THEN** only copilot models appear in that workspace's model picker

#### Scenario: No allowed_engines means all engines available
- **WHEN** a workspace has no `allowed_engines` field
- **THEN** all engines from `engines.yaml` are available in that workspace

### Requirement: Standalone session chat resolves workspace root for execution and discovery
The system SHALL resolve a standalone session's working directory and editor discovery scope from the active workspace configuration.

#### Scenario: Session execution uses workspace root
- **WHEN** a standalone session execution is started and the active workspace has `workspace_path` configured
- **THEN** the execution runs with that workspace path as its working directory

#### Scenario: Session execution falls back compatibly when workspace root missing
- **WHEN** a standalone session execution is started and the active workspace has no configured `workspace_path`
- **THEN** the system uses the existing compatible fallback path instead of failing the session turn
