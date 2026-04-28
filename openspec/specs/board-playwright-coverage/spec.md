## ADDED Requirements

### Requirement: Board DnD pointer-event lifecycle is covered by tests
The test suite SHALL verify the full drag-and-drop pointer event lifecycle on board task cards, including threshold gating, ghost clone creation, column highlight, successful drop, same-column drop no-op, cursor style changes, and capacity-blocked drop revert.

#### Scenario: Click below threshold does not start drag
- **WHEN** a `pointerdown` + `pointermove` of less than 5px is dispatched on a task card
- **THEN** no `.dragging` class appears on the card and no ghost element is appended to `document.body`

#### Scenario: Drag activates above 5px threshold
- **WHEN** a `pointerdown` + `pointermove` of 5 or more pixels is dispatched on a task card
- **THEN** the card receives a `.dragging` CSS class

#### Scenario: Ghost clone appears in document body during drag
- **WHEN** drag is active (above threshold)
- **THEN** a clone of the card is appended to `document.body` with `position: fixed` and `z-index: 9999`

#### Scenario: Target column receives droppable highlight during drag
- **WHEN** the pointer moves over a different column while dragging
- **THEN** that column element receives the `droppable-highlight` CSS class

#### Scenario: Successful drop calls tasks.transition and moves card
- **WHEN** pointer is released over a different column after a valid drag
- **THEN** `tasks.transition` is called with the correct `taskId` and `toState`, and the card appears in the target column

#### Scenario: Drop onto same column does not call tasks.transition
- **WHEN** pointer is released over the same column the card originated from
- **THEN** `tasks.transition` is NOT called

#### Scenario: User-select disabled during drag and restored on drop
- **WHEN** drag is active
- **THEN** `document.body` has `user-select: none`; after drop the style is removed

#### Scenario: Drop onto capacity-full column reverts card (expected failure)
- **WHEN** `tasks.transition` returns a capacity error
- **THEN** the card reverts to its original column

### Requirement: Unread indicators are covered by tests
The test suite SHALL verify that unread dots appear on task cards and workspace tabs when the correct WebSocket push events arrive, and that they clear when the task is selected.

#### Scenario: message.new for non-active task shows unread dot
- **WHEN** a `message.new` WS push arrives for a task that is not currently open in the chat drawer
- **THEN** the task card displays a `.task-card__unread-dot` element

#### Scenario: stream.event of assistant type for non-active task shows unread dot
- **WHEN** a `stream.event` WS push with type `assistant` arrives for a non-active task
- **THEN** the task card displays a `.task-card__unread-dot` element

#### Scenario: Selecting a task clears its unread dot
- **WHEN** a task has an unread dot and the user clicks the task card to open the chat drawer
- **THEN** the `.task-card__unread-dot` element is no longer visible

#### Scenario: Workspace tab shows unread dot when any task has unread
- **WHEN** any task in a workspace has an unread indicator
- **THEN** the workspace tab for that workspace displays a `.workspace-tab__unread-dot` element

### Requirement: Workspace tab navigation is covered by tests
The test suite SHALL verify that multiple workspace tabs are rendered and that switching tabs loads the correct boards.

#### Scenario: Multiple workspace tabs are visible
- **WHEN** the workspace config returns multiple workspaces
- **THEN** each workspace has a clickable tab visible in the board header

#### Scenario: Switching workspace tab loads boards for that workspace
- **WHEN** the user clicks a workspace tab different from the current active tab
- **THEN** `boards.list` is called for the selected workspace and its boards are rendered

### Requirement: Task creation form is covered by tests
The test suite SHALL verify the create-task flow: form visibility, successful submission, and title validation.

#### Scenario: New task button is visible in backlog column
- **WHEN** the board is loaded and a backlog column exists
- **THEN** a "New task" or equivalent creation trigger is visible in the backlog column

#### Scenario: Task creation form submission calls tasks.create and shows card
- **WHEN** the user fills in a valid title and submits the creation form
- **THEN** `tasks.create` is called with the correct params and the new task card appears in the backlog column

#### Scenario: Empty title prevents task creation
- **WHEN** the user attempts to submit the creation form with an empty title
- **THEN** the form does not call `tasks.create` and shows a validation hint

### Requirement: Column capacity enforcement is covered by tests
The test suite SHALL verify visual capacity indicators and error display when a transition is rejected due to a full column.

#### Scenario: Column at card limit shows capacity badge
- **WHEN** a column has `limit: N` and currently contains N tasks
- **THEN** the column header shows a capacity indicator (e.g., `N/N`)

#### Scenario: tasks.transition error due to capacity is displayed in UI
- **WHEN** `tasks.transition` returns a capacity error
- **THEN** an error message is displayed to the user on the board

#### Scenario: Column with limit: null has no capacity indicator
- **WHEN** a column has no `limit` set in the workflow template
- **THEN** no capacity indicator is rendered in the column header

#### Scenario: Capacity count updates when a card is moved out
- **WHEN** a card is moved out of a column that was at capacity
- **THEN** the capacity indicator reflects the new lower count

#### Scenario: Capacity is enforced across board reload
- **WHEN** the board is reloaded and a column is at its limit
- **THEN** the capacity indicator still shows the correct count

### Requirement: WebSocket execution-state reactivity is covered by tests
The test suite SHALL verify that task cards update their execution state badge reactively via WebSocket `task.updated` pushes, without requiring a page reload.

#### Scenario: task.updated running push updates card badge immediately
- **WHEN** a `task.updated` WS push arrives with `executionState: "running"` for a visible task
- **THEN** the task card's execution badge reflects "running" without a page reload

#### Scenario: task.updated completed push removes running badge
- **WHEN** a `task.updated` WS push arrives with `executionState: "completed"` for a task that showed "running"
- **THEN** the running badge is removed from the card without a page reload

### Requirement: Agent-initiated board mutations are covered by tests
The test suite SHALL verify that when an AI agent uses `create_task` or `move_task` tools, the board UI updates without a page reload via WebSocket push.

#### Scenario: Agent create_task causes new card to appear on board (expected failure)
- **WHEN** a `task.updated` WS push arrives with a task ID not previously known to the board
- **THEN** a new task card appears in the appropriate column without a page reload

#### Scenario: Agent move_task causes card to change column
- **WHEN** a `task.updated` WS push arrives for an existing task with a different `workflowState`
- **THEN** the card moves from its original column to the new column without a page reload

### Requirement: Project badge spec gap is documented with a failing test
The test suite SHALL include a `test.fail()` test that asserts a project key badge appears on task cards when `task.projectKey` is set, to document that this feature is specified but not yet implemented in `TaskCard.vue`.

#### Scenario: Task card shows project key badge (expected failure)
- **WHEN** a task has a non-null `projectKey` and is visible on the board
- **THEN** the task card renders a badge element containing the project key string
