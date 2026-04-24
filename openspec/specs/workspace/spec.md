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

### Requirement: Workspace config is hot-reloaded on demand
The system SHALL re-read `workspace.yaml` from disk and update all AI provider settings without restarting the application.

#### Scenario: Reload config reflects edited YAML
- **WHEN** the user edits `workspace.yaml` and clicks "Reload config" in the Setup view
- **THEN** all subsequent AI calls use the updated settings without restarting the app

#### Scenario: Invalid YAML on reload surfaces an error
- **WHEN** the user reloads config and `workspace.yaml` contains a parse error
- **THEN** an error message is shown in the Setup view and the previous valid configuration continues to apply

### Requirement: Default config files are created on first launch
The system SHALL auto-create `workspace.yaml` and the default workflow YAML when the config directory does not exist, so users can start without manual setup.

#### Scenario: Config directory created automatically
- **WHEN** the application starts and `~/.railyn/config/` does not exist
- **THEN** the directory and default config files are created with safe defaults (`provider: fake`)

### Requirement: Standalone session chat resolves workspace root for execution and discovery
The system SHALL resolve a standalone session's working directory and editor discovery scope from the active workspace configuration.

#### Scenario: Session execution uses workspace root
- **WHEN** a standalone session execution is started and the active workspace has `workspace_path` configured
- **THEN** the execution runs with that workspace path as its working directory

#### Scenario: Session execution falls back compatibly when workspace root missing
- **WHEN** a standalone session execution is started and the active workspace has no configured `workspace_path`
- **THEN** the system uses the existing compatible fallback path instead of failing the session turn
