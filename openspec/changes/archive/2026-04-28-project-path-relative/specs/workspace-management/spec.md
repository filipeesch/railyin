## MODIFIED Requirements

### Requirement: User can edit workspace settings from the UI
The system SHALL allow users to update a workspace's name, workspace path, engine type, engine default model, and worktree base path through the Setup view without editing YAML files manually. The workspace path (`workspace_path`) field SHALL appear after the name field and before the engine fields, with a browse button and a sub-label noting it is required for project registration.

#### Scenario: Workspace name updated
- **WHEN** the user edits the workspace name field and saves
- **THEN** the `name` field in `workspace.yaml` is updated and the workspace tab label reflects the new name

#### Scenario: Workspace path set via text input
- **WHEN** the user types an absolute path into the workspace path field and saves
- **THEN** the `workspace_path` field in `workspace.yaml` is updated and subsequent project registrations use the new path as the relative-path base

#### Scenario: Workspace path set via browse button
- **WHEN** the user clicks the browse button next to the workspace path field and selects a folder
- **THEN** the selected absolute path is placed in the field; saving writes it to `workspace_path` in `workspace.yaml`

#### Scenario: Engine type changed
- **WHEN** the user selects a different engine type (copilot or claude) and saves
- **THEN** the `engine.type` field in `workspace.yaml` is updated and the model list refreshes to show models from the new engine

#### Scenario: Engine model selected
- **WHEN** the user selects a model from the model dropdown and saves
- **THEN** the `engine.model` field in `workspace.yaml` is updated and subsequent executions use that model as the workspace default

#### Scenario: Worktree base path updated
- **WHEN** the user changes the worktree base path field and saves
- **THEN** the `worktree_base_path` field in `workspace.yaml` is updated and new worktrees are created under the new path

#### Scenario: Engine block deep-merged on partial update
- **WHEN** only `engine.model` is updated (not `engine.type`)
- **THEN** the existing `engine.type` value is preserved in `workspace.yaml`

## ADDED Requirements

### Requirement: WorkspaceConfig RPC type exposes workspace path
The `workspace.getConfig` response SHALL include the resolved `workspacePath` so the frontend can display it in the settings form and use it for inline project-path validation (e.g. warning when not set in the project dialog).

#### Scenario: workspacePath returned in config response
- **WHEN** the frontend calls `workspace.getConfig`
- **THEN** the response includes `workspacePath` set to the absolute workspace path (resolved via `workspace_path ?? configDir`)

#### Scenario: Project dialog warns when workspacePath not set
- **WHEN** the frontend opens the project add/edit dialog and `WorkspaceConfig.workspacePath` is not set
- **THEN** the dialog shows an inline warning: "workspace_path must be configured in Workspace settings before registering projects"
