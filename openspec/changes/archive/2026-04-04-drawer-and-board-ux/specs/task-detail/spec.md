## ADDED Requirements

### Requirement: Task detail drawer opens at 70% of viewport width by default and resets on close
The system SHALL initialise the task detail drawer width to 70% of the current viewport width when the component is first mounted, and SHALL reset to that value each time the drawer is closed.

#### Scenario: Drawer opens at 70% width
- **WHEN** the task detail drawer is opened for the first time in a session
- **THEN** the drawer width equals 70% of the viewport width at mount time

#### Scenario: Drawer resets to 70% after closing
- **WHEN** the drawer is closed (by clicking outside or the × button)
- **THEN** the next open uses the 70% default width, not any manually resized width from the previous session

#### Scenario: Manual resize preserves user preference within a single open
- **WHEN** the user drags the resize handle to a custom width
- **THEN** the drawer retains that custom width until it is closed

### Requirement: Task detail drawer closes on outside clicks but not on overlay interactions
The system SHALL close the task detail drawer when the user clicks outside it, UNLESS a PrimeVue overlay (dropdown panel, dialog backdrop) or an internal dialog (edit task, delete task) is currently active.

#### Scenario: Click on board closes drawer
- **WHEN** the task detail drawer is open and the user clicks on the board area (outside the drawer)
- **THEN** the drawer closes

#### Scenario: Click on Select dropdown does not close drawer
- **WHEN** the task detail drawer is open, a Select dropdown panel is open, and the user clicks an option in that panel
- **THEN** the drawer remains open and the selected value is applied

#### Scenario: Click in Delete dialog does not close drawer
- **WHEN** the delete task confirmation dialog is open
- **THEN** clicking within the dialog does not close the task detail drawer

#### Scenario: Click in Edit dialog does not close drawer
- **WHEN** the edit task dialog is open
- **THEN** clicking within the dialog does not close the task detail drawer

### Requirement: Chat input row contains a context-aware send/cancel action
The system SHALL render a single action button in the chat input row whose icon and behaviour adapt to the task's execution state.

#### Scenario: Send button shown when task is idle
- **WHEN** the task's `executionState` is not `running`
- **THEN** the action button shows a send icon and clicking it submits the textarea content

#### Scenario: Send button disabled when textarea is empty
- **WHEN** the task's `executionState` is not `running` and the textarea is empty
- **THEN** the send action button is disabled

#### Scenario: Cancel button shown when task is running
- **WHEN** the task's `executionState` is `running`
- **THEN** the action button shows a stop icon and clicking it cancels the running execution

#### Scenario: Cancel button is always enabled when task is running
- **WHEN** the task's `executionState` is `running`
- **THEN** the cancel action button is enabled regardless of textarea content

### Requirement: Model selector is placed below the chat textarea
The system SHALL display the model selector below the message textarea, within the input area, rather than in the side panel.

#### Scenario: Model selector visible below textarea
- **WHEN** the task detail drawer is open and models are available
- **THEN** the model selector is rendered below the textarea in the input area

#### Scenario: Model selector absent from side panel
- **WHEN** the task detail drawer is open
- **THEN** no model selector appears in the side panel metadata section

#### Scenario: Selecting a model does not close the drawer
- **WHEN** the user opens the model selector and selects a different model
- **THEN** the selected model is applied to the task and the drawer remains open

## MODIFIED Requirements

### Requirement: Task drawer displays git context and execution summary
The system SHALL display the task's worktree status, branch name, worktree path, git diff stat, and total execution attempt count in the side panel of the task detail drawer. The side panel SHALL NOT contain model selector or cancel execution controls.

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
