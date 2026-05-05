## MODIFIED Requirements

### Requirement: Worktree branch is named after the task
The system SHALL create a branch for each task worktree using the pattern `task/<task-id>-<slugified-title>`. The branch SHALL be created from the project's `default_branch` as configured in `workspace.yaml` (defaulting to `"main"` when not set). The auto-creation path SHALL NOT use the current `HEAD` of the git root as the source branch.

#### Scenario: Branch created from configured default branch
- **WHEN** a worktree is auto-created (no explicit `sourceBranch` provided)
- **THEN** `git worktree add -b task/<id>-<slug> <path> <project.defaultBranch>` is executed, using the project's configured `default_branch` (e.g. `"main"`, `"master"`, or any custom value)

#### Scenario: Branch created from default branch when default_branch not configured
- **WHEN** a worktree is auto-created and the project has no `default_branch` in workspace.yaml
- **THEN** the branch is created from `"main"` as the fallback

#### Scenario: Explicit sourceBranch overrides default branch
- **WHEN** `createWorktree` is called with an explicit `sourceBranch` option
- **THEN** the provided `sourceBranch` is used instead of the project's `default_branch`

#### Scenario: Branch name derived from task
- **WHEN** a worktree is auto-created for a task titled "Add settlement exception filters" with ID `123`
- **THEN** the branch is named `task/123-add-settlement-exception-filters`
