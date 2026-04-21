## MODIFIED Requirements

### Requirement: Claude engine lists commands via `session.supportedCommands()`
The system SHALL retrieve slash commands for Claude engine tasks by calling `sdkAdapter.listCommands(projectPath)` where `projectPath` is the configured project root directory for the task. The `projectPath` SHALL be resolved from the project store using the task's `board_id` and `project_key`. If `projectPath` is unavailable, the engine SHALL fall back to `worktree_path`, then to `process.cwd()`. No filesystem fallback is performed; the SDK handles all command discovery including user-level commands.

#### Scenario: Commands discovered from project root
- **WHEN** `listCommands(taskId)` is called and the task has a configured `projectPath`
- **THEN** the SDK is invoked with `cwd: projectPath` so `.claude/commands/` files in the project root are discovered

#### Scenario: Fallback to worktree path when project path unavailable
- **WHEN** `listCommands(taskId)` is called and `projectPath` cannot be resolved
- **THEN** the SDK is invoked with `cwd: worktreePath` (from `task_git_context`) instead

#### Scenario: Commands returned from active Claude session
- **WHEN** a Claude session is active and `supportedCommands()` returns results with `cwd: projectPath`
- **THEN** the picker shows those commands with name and description

#### Scenario: No session returns empty list
- **WHEN** no Claude session is active at the moment the picker opens
- **THEN** an empty list is returned and the picker shows the empty state
