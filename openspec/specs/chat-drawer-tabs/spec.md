## Purpose
The chat drawer toolbar provides persistent navigation and action controls for the task detail drawer, replacing the side panel with a tab-based layout.

## Requirements

### Requirement: Drawer toolbar contains a tab switcher on the left and an action cluster on the right
The system SHALL render a persistent toolbar row below the drawer header containing a tab switcher (Chat, Info) anchored to the left and an action cluster (workflow select, terminal button, run button, tools button) anchored to the right.

#### Scenario: Toolbar is always visible
- **WHEN** the task detail drawer is open
- **THEN** the toolbar row is visible regardless of which tab is active

#### Scenario: Chat tab is active by default
- **WHEN** the task detail drawer is opened for any task
- **THEN** the Chat tab is the active tab

#### Scenario: Switching to Info tab shows Info content
- **WHEN** the user clicks the Info tab
- **THEN** the Info tab becomes active and the drawer body shows the Info tab content

#### Scenario: Switching to Chat tab shows Chat content
- **WHEN** the user clicks the Chat tab
- **THEN** the Chat tab becomes active and the drawer body shows the conversation timeline, changed files panel, todo panel, and chat input

### Requirement: Workflow state select in toolbar shows current column and allows transition
The system SHALL render a Select dropdown in the toolbar showing the task's current workflow column as the selected value, and SHALL trigger a workflow transition when the user selects a different column.

#### Scenario: Select shows current column
- **WHEN** the toolbar is rendered
- **THEN** the workflow select displays the task's current workflow column name as its value

#### Scenario: Selecting a different column triggers transition
- **WHEN** the user opens the workflow select and chooses a column other than the current one
- **THEN** the system initiates a workflow transition to the selected column

#### Scenario: Select is not shown when task has no board
- **WHEN** the task has no associated board
- **THEN** the workflow select is not rendered in the toolbar

### Requirement: Terminal button in toolbar opens a terminal at the worktree path
The system SHALL render a terminal button in the toolbar action cluster that opens a terminal session at the task's worktree path.

#### Scenario: Terminal button is visible when worktree path is set
- **WHEN** the task has a worktree path
- **THEN** the terminal button is visible in the toolbar

#### Scenario: Terminal button is hidden when no worktree path
- **WHEN** the task does not have a worktree path
- **THEN** the terminal button is not rendered in the toolbar

#### Scenario: Clicking terminal button opens terminal at worktree path
- **WHEN** the user clicks the terminal button
- **THEN** the system opens a terminal session at the task's worktree path

### Requirement: Code editor button in toolbar opens code-server for the task
The system SHALL render a code editor button (`</>`) in the toolbar action cluster, positioned to the right of the terminal button, that opens the code editor overlay for the active task.

#### Scenario: Code editor button is visible when worktree path is set
- **WHEN** the task has a worktree path
- **THEN** the code editor button (`</>`) is visible in the toolbar action cluster, to the right of the terminal button

#### Scenario: Code editor button is hidden when no worktree path
- **WHEN** the task does not have a worktree path
- **THEN** the code editor button is not rendered in the toolbar

#### Scenario: Clicking code editor button opens the code editor overlay
- **WHEN** the user clicks the code editor button
- **THEN** the system opens the CodeServerOverlay for the active task

### Requirement: Playwright coverage for toolbar conditional controls
The system SHALL have Playwright test coverage verifying that the toolbar's conditional controls (workflow select, terminal button, code editor button, retry button) are shown or hidden based on actual task state properties, and that their interactions produce the expected side effects.

#### Scenario: Workflow select value reflects current column
- **WHEN** the task drawer opens for a task with `workflowState: "in-progress"`
- **THEN** the `.workflow-select` element shows "in-progress" as its selected value

#### Scenario: Workflow select change triggers transition
- **WHEN** the user selects a new column from the workflow select
- **THEN** `tasks.transition` is called with the new column id

#### Scenario: Terminal button hidden when worktreePath is null
- **WHEN** the task has `worktreePath: null`
- **THEN** no element matching the terminal button icon is present in the DOM

#### Scenario: Terminal button visible when worktreePath is set
- **WHEN** the task has `worktreePath: "/tmp/test"`
- **THEN** the terminal button is visible in the toolbar

#### Scenario: Code editor button hidden when worktreePath is null
- **WHEN** the task has `worktreePath: null`
- **THEN** the code editor button is not present in the DOM

#### Scenario: Code editor button visible when worktreePath is set
- **WHEN** the task has `worktreePath: "/tmp/test"`
- **THEN** the code editor button is visible in the toolbar

#### Scenario: Retry button absent for non-failed tasks
- **WHEN** the task has `executionState: "idle"`
- **THEN** no retry button is rendered

#### Scenario: Retry button visible for failed tasks
- **WHEN** the task has `executionState: "failed"`
- **THEN** the retry button is visible in the toolbar
