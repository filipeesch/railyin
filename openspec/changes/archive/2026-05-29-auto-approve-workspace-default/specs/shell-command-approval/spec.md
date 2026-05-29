## ADDED Requirements

### Requirement: Workspace defines a shell auto-approve default
The system SHALL support an optional `shell_auto_approve` boolean field in `workspace.yaml`. When `true`, newly created tasks in that workspace SHALL have their `shell_auto_approve` flag initialized to `true`. When absent or `false`, newly created tasks default to `false` (existing behavior).

#### Scenario: Workspace has shell_auto_approve true — new task starts with it on
- **WHEN** a workspace's `workspace.yaml` contains `shell_auto_approve: true`
- **THEN** any task created in that workspace has `shell_auto_approve = 1` in the database from the moment of creation

#### Scenario: Workspace has shell_auto_approve false or absent — new task starts with it off
- **WHEN** a workspace's `workspace.yaml` has `shell_auto_approve: false` or the field is absent
- **THEN** any task created in that workspace has `shell_auto_approve = 0` in the database (unchanged default behavior)

#### Scenario: Existing tasks unaffected when workspace setting changes
- **WHEN** the workspace `shell_auto_approve` setting is toggled after tasks already exist
- **THEN** existing tasks retain their current `shell_auto_approve` value; only newly created tasks receive the updated default

## MODIFIED Requirements

### Requirement: Per-task auto-approve toggle bypasses all approval prompts
The system SHALL support a per-task `shell_auto_approve` boolean field. When `true`, all `run_command` calls SHALL bypass the approval gate entirely and execute immediately without checking the approved set or issuing any prompt. The initial value of this field at task creation SHALL be seeded from the owning workspace's `shell_auto_approve` default (if set); otherwise it defaults to `false`.

#### Scenario: Auto-approve enabled skips all prompts
- **WHEN** `shell_auto_approve` is `true` on a task and the agent calls `run_command` with any command
- **THEN** the command executes immediately without an approval prompt, regardless of the approved set

#### Scenario: Auto-approve disabled falls back to approval check
- **WHEN** `shell_auto_approve` is `false` (default) on a task
- **THEN** every `run_command` call goes through the binary approval gate

#### Scenario: Task created in workspace with auto-approve on starts auto-approving
- **WHEN** the workspace has `shell_auto_approve: true` and a new task is created
- **THEN** the task immediately auto-approves all `run_command` calls without the user needing to toggle the per-task switch
