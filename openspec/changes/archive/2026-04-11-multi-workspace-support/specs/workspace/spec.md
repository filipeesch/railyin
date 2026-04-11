## MODIFIED Requirements

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
Each workspace SHALL store its own engine and AI provider settings in that workspace's `workspace.yaml`. Machine-level `config.yaml` MAY provide shared defaults, but AI executions SHALL use the owning workspace's resolved configuration.

#### Scenario: Different workspaces use different engines
- **WHEN** workspace A is configured with `engine.type: native` and workspace B is configured with `engine.type: copilot`
- **THEN** executions in each workspace use their respective engine configuration

#### Scenario: Global defaults are respected
- **WHEN** `config.yaml` defines a shared default such as `git_path` and a workspace does not override it locally
- **THEN** that workspace inherits the global value during config resolution

#### Scenario: Workspace-local override wins
- **WHEN** a workspace defines a value in its own `workspace.yaml` that is also present in `config.yaml`
- **THEN** the workspace-local value is used for that workspace's executions
