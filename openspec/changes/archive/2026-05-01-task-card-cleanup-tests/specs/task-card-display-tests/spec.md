## ADDED Requirements

### Requirement: file_diff stream event marks inactive task unread (unit)
The `onTaskStreamEvent` handler in `taskStore` SHALL mark a task as unread when a `file_diff` event arrives for a task that is not the currently active conversation, even after `refreshChangedFiles` is removed. This requirement exists to prevent the unread-detection logic from being accidentally deleted alongside the removed `changedFileCounts` state.

#### Scenario: file_diff event marks inactive task unread via onTaskStreamEvent
- **WHEN** `onTaskStreamEvent` is called with `{ type: "file_diff", taskId: 2, conversationId: 2 }` and task 2 is not the active conversation
- **THEN** `hasUnread(2)` returns `true`

#### Scenario: file_diff event does not mark active task unread via onTaskStreamEvent
- **WHEN** `onTaskStreamEvent` is called with `{ type: "file_diff", taskId: 1, conversationId: 1 }` and task 1 is the active conversation
- **THEN** `hasUnread(1)` returns `false`

### Requirement: file_diff message marks inactive task unread (unit)
The `onTaskNewMessage` handler in `taskStore` SHALL mark a task as unread when a `file_diff` message arrives for a task that is not the currently active conversation.

#### Scenario: file_diff message marks inactive task unread via onTaskNewMessage
- **WHEN** `onTaskNewMessage` is called with a message of type `file_diff` for a task not in the active conversation
- **THEN** `hasUnread` returns `true` for that task

#### Scenario: file_diff message does not mark active task unread via onTaskNewMessage
- **WHEN** `onTaskNewMessage` is called with a message of type `file_diff` for the active conversation's task
- **THEN** `hasUnread` returns `false` for that task

### Requirement: T8 (changedFileCounts unit test) is removed
The unit test `T8: deleteTask removes changedFileCounts entry` SHALL be deleted from `task.test.ts`. It references exports (`changedFileCounts`, `refreshChangedFiles`) that no longer exist after `task-card-cleanup` and will fail to compile.

#### Scenario: T8 does not exist in the test file
- **WHEN** the test suite for `taskStore` is run
- **THEN** no test named "T8: deleteTask removes changedFileCounts entry" exists

### Requirement: Project name displayed on task card (Playwright — PB-1)
The board UI SHALL display the project's `name` on each task card when `projects.list` returns a matching project.

#### Scenario: PB-1 — project name visible when project is loaded
- **WHEN** `projects.list` returns `[{ key: "test-project", name: "Test Project", ... }]` and the task has `projectKey: "test-project"`
- **THEN** the task card contains text "Test Project" in `.task-card__project` or `[data-testid="project-name"]`

### Requirement: Project key shown as fallback when project list is empty (Playwright — PB-2)
The board UI SHALL display the raw `projectKey` string on each task card when no matching project is found in `projects.list`.

#### Scenario: PB-2 — fallback to project key when projects not loaded
- **WHEN** `projects.list` returns `[]` and the task has `projectKey: "test-project"`
- **THEN** the task card contains text "test-project" in the project name element

### Requirement: Each card shows its own project on a multi-project board (Playwright — PB-3)
When a board has tasks belonging to different projects, each card SHALL independently resolve and display its own project name.

#### Scenario: PB-3 — two tasks show two distinct project names
- **WHEN** `projects.list` returns two projects (`key: "alpha", name: "Alpha"` and `key: "beta", name: "Beta"`) and `tasks.list` returns two tasks with `projectKey: "alpha"` and `projectKey: "beta"` respectively
- **THEN** the first task card shows "Alpha" and the second shows "Beta"

### Requirement: No file-changes badge on card after cleanup (Playwright — PB-4)
The task card SHALL NOT contain any element matching `.task-card__changed-badge` regardless of how many changed files a task has.

#### Scenario: PB-4 — changed-badge element absent even when files have changed
- **WHEN** `tasks.getChangedFiles` returns a non-empty list of file paths
- **THEN** no element matching `.task-card__changed-badge` exists in the DOM

### Requirement: No retry indicator on card after cleanup (Playwright — PB-5)
The task card SHALL NOT render a retry count indicator even when `retryCount` is greater than zero.

#### Scenario: PB-5 — retry indicator absent for task with retryCount > 0
- **WHEN** a task has `retryCount: 3`
- **THEN** no element matching `.task-card__retry-count` exists in the DOM

### Requirement: Project name and execution badge share the footer row (Playwright — PB-6)
The project name element and the execution-state badge SHALL both be direct children of `.task-card__footer`.

#### Scenario: PB-6 — both elements inside footer row
- **WHEN** a task card is rendered with a resolved project name
- **THEN** `.task-card__footer` contains both a `.p-tag` (execution badge) and the project name element as visible descendants
