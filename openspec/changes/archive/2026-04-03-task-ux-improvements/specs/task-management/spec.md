## ADDED Requirements

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
