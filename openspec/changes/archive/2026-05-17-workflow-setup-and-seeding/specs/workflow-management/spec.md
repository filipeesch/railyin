## ADDED Requirements

### Requirement: Setup screen exposes a Workflows tab before the Boards tab
The setup screen SHALL render a "Workflows" tab positioned immediately before the existing "Boards" tab. The tab SHALL look and behave consistently with the Boards tab. Selecting the tab SHALL load the current workspace's workflow templates.

#### Scenario: Workflows tab appears before Boards
- **WHEN** the user opens the setup screen
- **THEN** a "Workflows" tab is shown immediately to the left of the "Boards" tab

#### Scenario: Selecting the tab loads workflows
- **WHEN** the user selects the Workflows tab
- **THEN** the workflow templates for the active workspace are fetched and listed

### Requirement: Workflows tab lists workflow templates for the current workspace
The Workflows tab SHALL list every workflow template of the active workspace. Each row SHALL show the workflow name and, as a secondary label, its id.

#### Scenario: Each workflow is listed with name and id
- **WHEN** the Workflows tab is displayed
- **THEN** every workflow template of the active workspace appears as a row showing its name and its id as a secondary label

#### Scenario: List refreshes after a workflow is saved
- **WHEN** a workflow's YAML is saved from the editor overlay
- **THEN** the workflow list re-fetches and reflects the saved changes

### Requirement: Each workflow row provides edit and delete actions
Each workflow row SHALL provide a pencil button and a trash button. The pencil button SHALL open the workflow YAML editor overlay for that workflow. The trash button SHALL always be rendered; it SHALL be disabled when the workflow cannot be deleted.

#### Scenario: Pencil opens the YAML editor
- **WHEN** the user clicks a row's pencil button
- **THEN** the workflow YAML editor overlay opens pre-loaded with that workflow's raw YAML

#### Scenario: Editing a workflow is available from the same tab
- **WHEN** a new workflow has just been created and added to the list
- **THEN** its pencil button opens the YAML editor for that workflow without any further navigation

### Requirement: Deleting a workflow requires a confirmation dialog
The system SHALL show a confirmation dialog before any workflow deletion is performed. The deletion SHALL proceed only when the user confirms.

#### Scenario: Confirmation precedes deletion
- **WHEN** the user clicks an enabled trash button on a workflow row
- **THEN** a confirmation dialog appears and no file is deleted until the user confirms

#### Scenario: Cancelling aborts the deletion
- **WHEN** the user dismisses the confirmation dialog without confirming
- **THEN** the workflow is not deleted and the list is unchanged

#### Scenario: Confirmed deletion removes the workflow
- **WHEN** the user confirms the deletion of a deletable workflow
- **THEN** the workflow's YAML file is removed and the workflow disappears from the list

### Requirement: Workflows referenced by a board cannot be deleted
A workflow that is referenced by at least one board in the current workspace SHALL NOT be deletable. Its trash button SHALL be visible but disabled. The backend SHALL reject a delete request for such a workflow.

#### Scenario: Referenced workflow has a disabled delete button
- **WHEN** a workflow is referenced by one or more boards in the workspace
- **THEN** its trash button is rendered visible but disabled

#### Scenario: Backend rejects deleting a referenced workflow
- **WHEN** a `workflow.delete` request targets a workflow referenced by at least one board
- **THEN** the backend rejects the request with an error and the file is not removed

#### Scenario: Referenced reason takes precedence over the last-workflow reason
- **WHEN** a workflow is simultaneously the only remaining workflow and referenced by at least one board
- **THEN** the undeletable reason reports that it is referenced by boards

### Requirement: The last remaining workflow cannot be deleted
The system SHALL never allow the workspace to reach zero workflows. When only one workflow remains, its trash button SHALL be visible but disabled, and the backend SHALL reject a delete request for it.

#### Scenario: Last workflow has a disabled delete button
- **WHEN** only one workflow template exists in the workspace
- **THEN** that workflow's trash button is rendered visible but disabled

#### Scenario: Backend rejects deleting the last workflow
- **WHEN** a `workflow.delete` request targets the only remaining workflow
- **THEN** the backend rejects the request with an error and the file is not removed

### Requirement: Bundled workflows cannot be deleted
A workflow whose id is provided by the bundled workflows source SHALL NOT be deletable — seeding would recreate it on the next configuration load. Its trash button SHALL be visible but disabled, and the backend SHALL reject a delete request for it. Bundled workflows remain fully editable through the YAML editor. The bundled reason takes precedence over the referenced-by-board and last-workflow reasons.

#### Scenario: Bundled workflow has a disabled delete button
- **WHEN** a workflow's id matches a workflow in the bundled source
- **THEN** its trash button is rendered visible but disabled

#### Scenario: Backend rejects deleting a bundled workflow
- **WHEN** a `workflow.delete` request targets a bundled workflow
- **THEN** the backend rejects the request with an error and the file is not removed

#### Scenario: Bundled reason takes precedence over the other guards
- **WHEN** a bundled workflow is also referenced by a board or is the last remaining workflow
- **THEN** the undeletable reason reports that it is a bundled workflow

### Requirement: Adding a workflow asks only for a name
An "+ Add Workflow" button SHALL create a new workflow. The creation dialog SHALL ask only for a name. The system SHALL derive an id from the name, write a new YAML file containing a minimal valid set of columns to the workspace workflows directory, and add the workflow to the list.

#### Scenario: Add dialog requests only a name
- **WHEN** the user clicks "+ Add Workflow"
- **THEN** a dialog appears requesting only a workflow name

#### Scenario: New workflow is created and listed
- **WHEN** the user submits a name in the Add Workflow dialog
- **THEN** a new YAML file with a minimal valid column set is written to the workspace workflows directory and the workflow appears in the list

#### Scenario: Id is derived from the name
- **WHEN** the user submits a name
- **THEN** the workflow id is a slug derived from that name (lowercase, non-alphanumeric characters replaced with dashes)

#### Scenario: Id collision is resolved automatically
- **WHEN** the derived id matches an existing workflow file
- **THEN** the system appends a numeric suffix (`-2`, `-3`, …) so creation succeeds without prompting the user again

#### Scenario: Name with no slug-able characters falls back to a default id
- **WHEN** the submitted name contains no alphanumeric characters and slugifies to an empty string
- **THEN** the workflow id falls back to `workflow`, with numeric suffixing applied if that id is already taken

### Requirement: Workflow list and mutation RPC methods
The backend SHALL provide `workflow.list`, `workflow.create`, and `workflow.delete` RPC methods. `workflow.list` SHALL return, for each workflow of the workspace, its id, name, the count of boards referencing it, whether it is deletable, and a reason when it is not. `workflow.create` SHALL create a new workflow file from a name. `workflow.delete` SHALL remove a workflow file after enforcing the deletion guards.

#### Scenario: workflow.list returns guard metadata
- **WHEN** `workflow.list` is called for a workspace
- **THEN** each returned workflow includes its board reference count, a deletable flag, and an undeletable reason when not deletable

#### Scenario: workflow.create returns the created workflow
- **WHEN** `workflow.create` is called with a name
- **THEN** the response identifies the newly created workflow's id

#### Scenario: Mutations reload config and notify the frontend
- **WHEN** `workflow.create` or `workflow.delete` completes successfully
- **THEN** the in-memory config is reloaded and a workflow-reloaded notification is broadcast to the frontend
