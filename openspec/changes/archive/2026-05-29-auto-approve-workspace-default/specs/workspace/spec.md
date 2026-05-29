## ADDED Requirements

### Requirement: Workspace exposes shell auto-approve default through the config API
The system SHALL include a `shellAutoApprove` boolean field in the `WorkspaceConfig` RPC type returned by `workspace.getConfig`. The value SHALL reflect the `shell_auto_approve` field from `workspace.yaml`, defaulting to `false` when absent.

#### Scenario: workspace.getConfig returns shellAutoApprove true when set
- **WHEN** a workspace's `workspace.yaml` contains `shell_auto_approve: true`
- **THEN** `workspace.getConfig` returns `{ shellAutoApprove: true }` in the response

#### Scenario: workspace.getConfig returns shellAutoApprove false when absent
- **WHEN** a workspace's `workspace.yaml` does not contain `shell_auto_approve`
- **THEN** `workspace.getConfig` returns `{ shellAutoApprove: false }` in the response

### Requirement: Workspace settings API accepts shell auto-approve updates
The `workspace.update` RPC method SHALL accept an optional `shellAutoApprove` boolean parameter. When provided, it SHALL be persisted to `workspace.yaml` as `shell_auto_approve` via the existing YAML patch mechanism.

#### Scenario: Setting shellAutoApprove true persists to workspace.yaml
- **WHEN** `workspace.update` is called with `{ shellAutoApprove: true }`
- **THEN** the workspace's `workspace.yaml` is updated with `shell_auto_approve: true`

#### Scenario: Setting shellAutoApprove false clears the field
- **WHEN** `workspace.update` is called with `{ shellAutoApprove: false }`
- **THEN** the workspace's `workspace.yaml` is updated with `shell_auto_approve: false` (or the field is removed)

### Requirement: Workspace settings UI exposes shell auto-approve toggle
The Workspace settings tab in the setup UI SHALL display a toggle labeled "Auto-approve shell commands" after the worktree base path field. The toggle SHALL reflect the current workspace `shellAutoApprove` value and SHALL be persisted when the user clicks "Save settings".

#### Scenario: Toggle reflects persisted workspace value on load
- **WHEN** the user opens the Workspace settings tab and the workspace has `shell_auto_approve: true`
- **THEN** the auto-approve toggle is shown in the ON position

#### Scenario: Toggling and saving persists the new value
- **WHEN** the user flips the toggle and clicks "Save settings"
- **THEN** `workspace.update` is called with the new `shellAutoApprove` value and the YAML is updated
