# board-management-tests Specification

## Purpose
TBD - created by archiving change boards-management-tab-tests. Update Purpose after archive.
## Requirements
### Requirement: boards.update handler is covered by backend unit tests
The system SHALL have backend unit tests for `boards.update` verifying each field combination, the partial-update invariant, validation failures, and missing-record errors.

#### Scenario: DR-1 DI regression — boardHandlers() works without db parameter
- **WHEN** `boardHandlers()` is called with no arguments and `boards.list` is invoked after `initDb()`
- **THEN** it returns boards without throwing

#### Scenario: BC-1 Create returns board with taskCount 0
- **WHEN** `boards.create` is called with valid name and workflowTemplateId
- **THEN** the returned Board has `taskCount: 0`

#### Scenario: BC-2 Create falls back to first template on invalid templateId
- **WHEN** `boards.create` is called with a workflowTemplateId that does not exist in config
- **THEN** the board is created using the first available workflow template without throwing

#### Scenario: BU-1 Update name only — name changes, other fields unchanged
- **WHEN** `boards.update` is called with `{ id, name: "New Name" }`
- **THEN** the board's name is "New Name", `workflowTemplateId` and `projectKeys` are unchanged from their original values

#### Scenario: BU-2 Update workflowTemplateId only — template changes, name unchanged
- **WHEN** `boards.update` is called with `{ id, workflowTemplateId: "delivery" }`
- **THEN** the board's `workflowTemplateId` is "delivery" and the name is unchanged

#### Scenario: BU-3 Update projectKeys — JSON round-trips correctly
- **WHEN** `boards.update` is called with `{ id, projectKeys: ["proj-a", "proj-b"] }`
- **THEN** the returned board has `projectKeys: ["proj-a", "proj-b"]`

#### Scenario: BU-4 Empty projectKeys array is a valid update
- **WHEN** `boards.update` is called with `{ id, projectKeys: [] }`
- **THEN** the board is saved with an empty `projectKeys` array without error

#### Scenario: BU-5 Invalid workflowTemplateId rejected — board not mutated
- **WHEN** `boards.update` is called with a `workflowTemplateId` that does not exist in workspace config
- **THEN** the handler throws and the board's original `workflowTemplateId` is unchanged (verified by re-fetching)

#### Scenario: BU-6 Non-existent board id throws
- **WHEN** `boards.update` is called with an id that does not exist in the database
- **THEN** the handler throws

### Requirement: boards.delete handler is covered by backend unit tests
The system SHALL have backend unit tests for `boards.delete` verifying empty-board deletion, task-guard enforcement, and dynamic task count in the error message.

#### Scenario: BD-1 Empty board deleted — row gone from DB
- **WHEN** `boards.delete` is called for a board with zero tasks
- **THEN** it returns `{}` and the board row is no longer present in the database

#### Scenario: BD-2 Board with 1 task — throws with count in message
- **WHEN** `boards.delete` is called for a board with 1 task
- **THEN** it throws with a message containing "1"

#### Scenario: BD-3 Board with 3 tasks — error message contains count 3
- **WHEN** `boards.delete` is called for a board with 3 tasks
- **THEN** it throws with a message containing "3"

#### Scenario: BD-4 Board row survives failed delete
- **WHEN** `boards.delete` throws because the board has tasks
- **THEN** the board row still exists in the database

### Requirement: boards.list returns taskCount per board
The system SHALL have backend unit tests verifying that `boards.list` returns a correct `taskCount` for each board.

#### Scenario: BL-1 Fresh board has taskCount 0
- **WHEN** `boards.list` is called for a newly created board with no tasks
- **THEN** the board entry has `taskCount: 0`

#### Scenario: BL-2 Board with tasks has correct taskCount
- **WHEN** 2 tasks are inserted for a board and `boards.list` is called
- **THEN** the board entry has `taskCount: 2`

#### Scenario: BL-3 taskCount is per-board — other boards unaffected
- **WHEN** boardA has 2 tasks and boardB has 0 tasks
- **THEN** `boards.list` returns `boardA.taskCount = 2` and `boardB.taskCount = 0`

### Requirement: board store updateBoard and deleteBoard are covered by unit tests
The system SHALL have Pinia store unit tests for `updateBoard` and `deleteBoard` actions — verifying API call shape, state management, and error propagation.

#### Scenario: SU-1 updateBoard calls boards.update with correct params
- **WHEN** `updateBoard(id, { name: "Renamed" })` is called
- **THEN** `api("boards.update", { id, name: "Renamed" })` is called with those exact params

#### Scenario: SU-2 updateBoard triggers loadBoards after success
- **WHEN** `updateBoard` succeeds
- **THEN** `api("boards.list")` is called to refresh the board list

#### Scenario: SU-3 updateBoard propagates API errors
- **WHEN** `api("boards.update")` throws
- **THEN** the error propagates from `updateBoard` (not swallowed)

#### Scenario: SD-1 deleteBoard calls boards.delete with correct id
- **WHEN** `deleteBoard(id)` is called
- **THEN** `api("boards.delete", { id })` is called with that id

#### Scenario: SD-2 deleteBoard removes board from boards.value
- **WHEN** `deleteBoard(id)` succeeds
- **THEN** the board with that id is no longer in `boards.value`

#### Scenario: SD-3 deleteBoard of active board switches activeBoardId
- **WHEN** `deleteBoard` is called for the board that is currently `activeBoardId`
- **THEN** `activeBoardId` switches to the first remaining board's id

#### Scenario: SD-4 deleteBoard of only board sets activeBoardId to null
- **WHEN** `deleteBoard` is called and no boards remain
- **THEN** `activeBoardId` becomes null

#### Scenario: SD-5 deleteBoard does not mutate boards.value on API error
- **WHEN** `api("boards.delete")` throws
- **THEN** `boards.value` still contains the board (no optimistic removal)

### Requirement: Boards Setup tab UI is covered by Playwright tests
The system SHALL have Playwright UI tests for all board CRUD interactions in the Setup view, using mock-api.ts intercepts and makeBoard() factory.

#### Scenario: B-1 Board list renders name and workflow template name
- **WHEN** `boards.list` returns boards with names and template data
- **THEN** each board's name and template name are visible in the board list

#### Scenario: B-2 Empty board list shows only Add board button
- **WHEN** `boards.list` returns an empty array
- **THEN** no board items are rendered and the "Add board" button is visible

#### Scenario: BA-1 Add board button opens dialog
- **WHEN** the user clicks "Add board"
- **THEN** a dialog with title containing "Add board" is visible

#### Scenario: BA-2 Create button disabled when name is empty
- **WHEN** the dialog is open and the name field is empty
- **THEN** the Create button is disabled

#### Scenario: BA-4 New board saved via boards.create
- **WHEN** the user fills name and workflow and clicks Create
- **THEN** `boards.create` is called with the correct name and workflowTemplateId

#### Scenario: BA-5 Project checkboxes populate projectKeys in payload
- **WHEN** the user checks a project checkbox before saving
- **THEN** `boards.create` is called with that project key in `projectKeys`

#### Scenario: BA-6 Dialog closes after successful create
- **WHEN** `boards.create` succeeds
- **THEN** the dialog is no longer visible

#### Scenario: BE-1 Edit dialog pre-filled with board name
- **WHEN** the user clicks Edit on a board
- **THEN** the dialog name field contains the board's current name

#### Scenario: BE-3 Rename saves via boards.update
- **WHEN** the user edits the name and clicks Save
- **THEN** `boards.update` is called with `{ id, name: "New Name" }`

#### Scenario: BE-4 Project checkbox changes saved to boards.update
- **WHEN** the user toggles a project checkbox and saves
- **THEN** `boards.update` is called with the updated `projectKeys`

#### Scenario: BW-1 No workflow warning when board has taskCount 0
- **WHEN** `makeBoard({ taskCount: 0 })` and user changes workflow in edit dialog
- **THEN** no warning message is visible

#### Scenario: BW-2 Workflow warning shown when board has taskCount > 0
- **WHEN** `makeBoard({ taskCount: 3 })` and user changes workflow in edit dialog
- **THEN** an inline warning message is visible in the dialog

#### Scenario: BW-3 Warning does not disable Save button
- **WHEN** the inline workflow-change warning is visible
- **THEN** the Save button remains enabled

#### Scenario: BD-1 Delete on board with tasks shows toast — no confirm dialog
- **WHEN** `makeBoard({ taskCount: 1 })` and user clicks Delete
- **THEN** a toast notification appears and no confirm dialog opens

#### Scenario: BD-2 Delete on empty board shows confirm dialog
- **WHEN** `makeBoard({ taskCount: 0 })` and user clicks Delete
- **THEN** a confirm dialog appears

#### Scenario: BD-4 Confirming delete calls boards.delete with correct id
- **WHEN** user confirms the delete dialog
- **THEN** `boards.delete` is called with `{ id: board.id }`

#### Scenario: BD-5 Board disappears from list after delete
- **WHEN** `boards.delete` succeeds
- **THEN** the board is no longer in the list

#### Scenario: BD-6 Cancelling confirm dialog makes no API call
- **WHEN** user opens confirm dialog and clicks Cancel
- **THEN** `boards.delete` is not called and the board remains in the list

#### Scenario: BER-1 boards.create failure shows error in dialog
- **WHEN** `api.handle("boards.create", () => { throw new Error(...) })`
- **THEN** an error message is shown inside the dialog

#### Scenario: BER-3 boards.delete failure shows error in confirm dialog
- **WHEN** `api.handle("boards.delete", () => { throw new Error(...) })`
- **THEN** an error message is shown inside the confirm dialog

