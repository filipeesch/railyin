## ADDED Requirements

### Requirement: Task card shows changed-files badge when worktree has uncommitted changes
The system SHALL display a changed-files badge on the task card whenever `tasks.getChangedFiles` returns a non-empty array for that task. The badge SHALL be visible in any column. Clicking the badge SHALL open the code review overlay for that task.

#### Scenario: Badge shown on task card when files changed
- **WHEN** a task card is rendered and the task's worktree has uncommitted changes
- **THEN** a changed-files badge showing the file count is visible on the card

#### Scenario: Clicking badge on task card opens review overlay
- **WHEN** the user clicks the changed-files badge on a task card
- **THEN** the code review overlay opens for that task

#### Scenario: Badge absent when worktree is clean
- **WHEN** a task card is rendered and the task's worktree has no uncommitted changes
- **THEN** no changed-files badge appears on the card

#### Scenario: Badge visible in any column
- **WHEN** a task with changed files is in any workflow column (backlog, plan, in_progress, in_review, done, or custom)
- **THEN** the changed-files badge is visible on the task card
