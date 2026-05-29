## ADDED Requirements

### Requirement: workspace.getConfig returns shellAutoApprove

The handler SHALL return `shellAutoApprove: false` when `shell_auto_approve` is absent from `workspace.yaml`, and SHALL return the stored boolean value when the field is present.

#### Scenario: Field absent defaults to false
- **WHEN** `workspace.yaml` does not contain `shell_auto_approve`
- **THEN** `workspace.getConfig` response includes `shellAutoApprove: false`

#### Scenario: Field true is reflected
- **WHEN** `workspace.yaml` contains `shell_auto_approve: true`
- **THEN** `workspace.getConfig` response includes `shellAutoApprove: true`

#### Scenario: Field false is reflected
- **WHEN** `workspace.yaml` contains `shell_auto_approve: false`
- **THEN** `workspace.getConfig` response includes `shellAutoApprove: false`

### Requirement: workspace.update persists shellAutoApprove

The handler SHALL write `shell_auto_approve` to `workspace.yaml` via `patchWorkspaceYaml` when `shellAutoApprove` is included in the update params, and SHALL preserve all other existing YAML fields.

#### Scenario: True written to yaml
- **WHEN** `workspace.update` is called with `shellAutoApprove: true`
- **THEN** `workspace.yaml` contains `shell_auto_approve: true`
- **AND** pre-existing YAML fields (e.g., `name`, `default_model`) are unchanged

#### Scenario: False written to yaml
- **WHEN** `workspace.update` is called with `shellAutoApprove: false`
- **THEN** `workspace.yaml` contains `shell_auto_approve: false`

### Requirement: tasks.create seeds shell_auto_approve from workspace config

`tasks.create` SHALL read the workspace's `shell_auto_approve` value at creation time and INSERT it as the task's initial `shell_auto_approve` value. Subsequent changes to the workspace setting SHALL NOT affect existing tasks.

#### Scenario: Workspace has shell_auto_approve true — task seeded true
- **WHEN** the workspace config has `shell_auto_approve: true`
- **AND** `tasks.create` is called
- **THEN** the returned task has `shellAutoApprove: true`

#### Scenario: Workspace has no shell_auto_approve — task seeded false
- **WHEN** the workspace config does not have `shell_auto_approve`
- **AND** `tasks.create` is called
- **THEN** the returned task has `shellAutoApprove: false`

#### Scenario: Workspace has shell_auto_approve false — task seeded false
- **WHEN** the workspace config has `shell_auto_approve: false`
- **AND** `tasks.create` is called
- **THEN** the returned task has `shellAutoApprove: false`

#### Scenario: Per-task toggle remains independent after seeding
- **WHEN** a task was seeded with `shellAutoApprove: true` from workspace config
- **AND** `tasks.setShellAutoApprove` is called on that task with `false`
- **THEN** the task's `shellAutoApprove` is `false`
- **AND** the workspace setting is unchanged

### Requirement: Settings UI toggle reflects and saves shellAutoApprove

The Workspace settings tab SHALL render a toggle for "Auto-approve shell commands" that reflects the current workspace config and sends the correct value via `workspace.update` on save.

#### Scenario: Toggle renders visible in Workspace tab
- **WHEN** the user navigates to Settings → Workspace tab
- **THEN** the "Auto-approve shell commands" toggle is visible

#### Scenario: Toggle reflects false from config
- **WHEN** `workspace.getConfig` returns `shellAutoApprove: false`
- **THEN** the toggle is rendered unchecked

#### Scenario: Toggle reflects true from config
- **WHEN** `workspace.getConfig` returns `shellAutoApprove: true`
- **THEN** the toggle is rendered checked

#### Scenario: Enabling toggle and saving sends true
- **WHEN** the user enables the toggle
- **AND** clicks Save Settings
- **THEN** `workspace.update` is called with `shellAutoApprove: true`

#### Scenario: Disabling toggle and saving sends false
- **WHEN** the user disables the toggle
- **AND** clicks Save Settings
- **THEN** `workspace.update` is called with `shellAutoApprove: false`
