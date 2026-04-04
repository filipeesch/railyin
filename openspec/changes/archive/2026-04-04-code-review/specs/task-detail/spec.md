## ADDED Requirements

### Requirement: Task detail drawer header shows changed-files badge and sync button
The system SHALL display a changed-files badge in the task detail drawer header when `tasks.getChangedFiles` returns a non-empty array for the task. The badge SHALL show the file count and, when clicked, SHALL open the code review overlay. The system SHALL also display a sync (refresh) button in the drawer header at all times when a task is open; clicking it calls `tasks.getChangedFiles` and updates the badge count without opening the overlay.

#### Scenario: Badge shown in drawer header when files are changed
- **WHEN** the task detail drawer is open and the task's worktree has uncommitted changes
- **THEN** a badge showing the changed file count is visible in the drawer header

#### Scenario: Clicking badge in drawer header opens review overlay
- **WHEN** the user clicks the changed-files badge in the task detail drawer header
- **THEN** the code review overlay opens for that task

#### Scenario: Badge absent from drawer when worktree is clean
- **WHEN** the task detail drawer is open and the worktree has no uncommitted changes
- **THEN** no changed-files badge appears in the drawer header

#### Scenario: Sync button refreshes changed-files count
- **WHEN** the user clicks the sync button in the drawer header
- **THEN** `tasks.getChangedFiles` is called and the badge count updates to reflect the current state of the worktree

#### Scenario: Changed-files count refreshed on drawer open
- **WHEN** the task detail drawer opens for a task with `worktreeStatus: 'ready'`
- **THEN** `tasks.getChangedFiles` is called automatically and the badge reflects the current count
