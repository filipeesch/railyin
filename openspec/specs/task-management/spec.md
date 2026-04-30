## Purpose
Allows users to edit task metadata before a worktree is created, and to fully delete a task including its worktree, conversation, and database records.

## Requirements

### Requirement: Task title and description can be edited before worktree is created
The system SHALL allow a user to edit a task's title and description while the task's worktree has not yet been created (`worktree_status = 'not_created'`). Once a worktree exists, editing SHALL be locked.

#### Scenario: Edit action available before worktree exists
- **WHEN** a task's `worktree_status` is `not_created`
- **THEN** an edit action (e.g. pencil icon) is available in the task detail drawer header or task card menu

#### Scenario: Edits persisted via tasks.update
- **WHEN** the user saves edited title and/or description
- **THEN** the task's `title` and `description` are updated in the database and the board card reflects the new title

#### Scenario: Edit locked once worktree exists
- **WHEN** a task's `worktree_status` is `creating` or `ready`
- **THEN** the edit action is disabled with a tooltip explaining the lock (e.g. "Branch already created")

### Requirement: Task fields have conditional editability based on column position
The system SHALL implement conditional editability for task fields where title and project are editable only when the task is in the backlog column, regardless of worktree status.

#### Scenario: Task fields editable when in backlog column
- **WHEN** a task is positioned in the backlog column
- **THEN** the task title and project fields are editable in the task overlay

#### Scenario: Task fields readonly when not in backlog column
- **WHEN** a task is positioned in any column other than backlog
- **THEN** the task title and project fields are readonly in the task overlay

#### Scenario: Description content still editable in non-backlog columns
- **WHEN** a task is positioned in any column including non-backlog columns
- **THEN** the task description can still be viewed in Preview/Edit modes in the task overlay

### Requirement: Task overlay save button hidden for non-backlog tasks
The system SHALL hide the save button in the task overlay when editing a task that is not in the backlog column.

#### Scenario: Save button visible for backlog tasks
- **WHEN** a task in the backlog column is being edited in the overlay
- **THEN** the save button is visible and enabled

#### Scenario: Save button hidden for non-backlog tasks
- **WHEN** a task not in the backlog column is being edited in the overlay
- **THEN** the save button is hidden

### Requirement: A task and all associated data can be deleted
The system SHALL allow the user to delete a task. Deletion SHALL cascade to remove all related records and the worktree directory, while keeping the git branch.

#### Scenario: Confirmation required before deletion
- **WHEN** the user triggers delete on a task
- **THEN** a confirmation dialog is shown warning that the worktree and all chat history will be removed

#### Scenario: Running execution cancelled before deletion
- **WHEN** a task with `execution_state = 'running'` is deleted
- **THEN** the execution is cancelled first, then deletion proceeds

#### Scenario: Worktree directory removed on delete
- **WHEN** a task with a worktree at `worktree_path` is deleted
- **THEN** `git worktree remove --force <worktree_path>` is executed; failures are logged but do not block deletion

#### Scenario: Git branch kept on delete
- **WHEN** a task is deleted
- **THEN** the git branch associated with the task is NOT deleted

#### Scenario: All DB records removed on delete
- **WHEN** a task is deleted
- **THEN** its conversation messages, executions, git context, conversation, and task record are all removed from the database

#### Scenario: Task removed from board after deletion
- **WHEN** deletion completes
- **THEN** the task disappears from the board view and the task detail drawer closes

### Requirement: Handler keys are grouped into domain-scoped modules
The backend handler layer SHALL organize handler keys into domain-scoped modules so that each file has a single responsibility. The modules SHALL be: `tasks.ts` (CRUD + lifecycle), `task-git.ts` (worktree + git ops), `code-review.ts` (hunk decisions + line comments), `todos.ts` (todo CRUD), `models.ts` (model management), `engine.ts` (engine commands).

#### Scenario: All original handler keys remain accessible
- **WHEN** `allHandlers` is assembled in `index.ts` by spreading all domain factories
- **THEN** every handler key that existed before the split SHALL be present and callable with identical behavior

#### Scenario: Each factory accepts only the dependencies it uses
- **WHEN** a handler factory function is called
- **THEN** it SHALL only accept parameters that it actually invokes — no phantom dependencies

#### Scenario: Diff utility functions are in the git module
- **WHEN** code-review handlers need diff parsing
- **THEN** they SHALL import from `src/bun/git/diff-utils.ts`, not from handler files
