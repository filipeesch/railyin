## Purpose
The task detail drawer is the primary surface for interacting with a task. Beyond conversation, it surfaces git context, execution metadata, and management actions.

## Requirements

### Requirement: Task drawer displays git context and execution summary
The system SHALL display the task's worktree status, branch name, worktree path, git diff stat, and total execution attempt count in the side panel of the task detail drawer.

#### Scenario: Branch name shown in side panel
- **WHEN** a task detail drawer is open and the task has a branch name in `task_git_context`
- **THEN** the branch name is displayed in the side panel

#### Scenario: Worktree path shown in side panel
- **WHEN** a task's `worktree_status` is `ready`
- **THEN** the worktree path is displayed in the side panel

#### Scenario: Worktree status shown in side panel
- **WHEN** a task detail drawer is open
- **THEN** the worktree status (`not_created`, `creating`, or `ready`) is shown in a human-readable form

#### Scenario: Git diff stat shown when worktree ready
- **WHEN** a task's worktree is in `ready` status and the drawer opens
- **THEN** `git diff --stat HEAD` is fetched via `tasks.getGitStat` and the result is displayed in the side panel

#### Scenario: Git diff stat not shown when worktree not ready
- **WHEN** a task's `worktree_status` is `not_created` or `creating`
- **THEN** no git diff stat section is displayed

#### Scenario: Execution count shown in side panel
- **WHEN** a task detail drawer is open
- **THEN** the total number of executions for the task is displayed in the side panel
