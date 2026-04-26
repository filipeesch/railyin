## Purpose
Workspace management covers the UI-driven lifecycle of workspaces: creating new workspaces, editing their settings, and keeping YAML files clean — all through the Setup view without manual file editing.

## Requirements

### Requirement: User can create a new workspace from the UI
The system SHALL allow users to create a new workspace by providing a name in the Setup view. The backend SHALL derive a filesystem-safe key from the name, scaffold the workspace directory with default `workspace.yaml` and workflow files, and return the new workspace summary.

#### Scenario: Workspace created successfully
- **WHEN** the user enters a name (e.g. "My Team") and submits the create workspace form
- **THEN** the backend creates `~/.railyn/workspaces/my-team/` with a default `workspace.yaml`, the new workspace appears in the workspace selector, and the UI switches to the new workspace

#### Scenario: Duplicate workspace key rejected
- **WHEN** the user attempts to create a workspace whose derived key matches an existing workspace
- **THEN** the backend returns an error and the form displays the message without creating any files

#### Scenario: Derived key shown before submit
- **WHEN** the user types a workspace name in the creation dialog
- **THEN** the dialog shows the auto-derived key (e.g. `my-team`) as read-only so the user knows the folder name before confirming

### Requirement: User can edit workspace settings from the UI
The system SHALL allow users to update a workspace's name, engine type, engine default model, and worktree base path through the Setup view without editing YAML files manually.

#### Scenario: Workspace name updated
- **WHEN** the user edits the workspace name field and saves
- **THEN** the `name` field in `workspace.yaml` is updated and the workspace tab label reflects the new name

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

### Requirement: Deprecated workspace config fields are stripped on write
The system SHALL remove `git_path` and `shell_env_timeout_ms` from `workspace.yaml` whenever a workspace is written through the `patchWorkspaceYaml` function, as these fields are no longer functional.

#### Scenario: Deprecated fields removed on next save
- **WHEN** a workspace YAML file contains `git_path` or `shell_env_timeout_ms` and any workspace update is saved
- **THEN** those keys are absent from the written YAML file

### Requirement: WorkspaceConfig RPC type exposes engine configuration
The `workspace.getConfig` response SHALL include the resolved engine type and optional model so the frontend can pre-populate the settings form without reading YAML directly.

#### Scenario: Engine fields returned in config response
- **WHEN** the frontend calls `workspace.getConfig`
- **THEN** the response includes `engine.type` (e.g. `"copilot"`) and `engine.model` (e.g. `"gpt-4.1"` or `null` if unset)
