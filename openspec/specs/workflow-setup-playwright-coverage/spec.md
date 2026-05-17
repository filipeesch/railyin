# Spec: workflow-setup-playwright-coverage

## Purpose

Playwright end-to-end coverage for the Workflows tab in the setup screen, including list rendering, delete guards, add-workflow flow, editor overlay lifecycle, board-header pencil removal, and reload push event handling — all driven via API mocks.

## Requirements

### Requirement: The Workflows tab placement and list are Playwright-covered
The Playwright suite SHALL verify the Workflows tab and its row list, with all `workflow.*` RPCs supplied by the API mock.

#### Scenario: Workflows tab is placed before the Boards tab
- **WHEN** the setup screen is opened
- **THEN** a "Workflows" tab is present immediately before the "Boards" tab

#### Scenario: Each workflow row shows its name and id
- **WHEN** the Workflows tab is selected with a mocked `workflow.list`
- **THEN** each workflow renders as a row showing its name and its id as a secondary label, with a pencil and a trash button

### Requirement: Delete guards and confirmation are Playwright-covered
The Playwright suite SHALL verify the disabled-delete states and the confirmation flow.

#### Scenario: Trash is disabled for a referenced workflow
- **WHEN** `workflow.list` reports a workflow as not deletable because it is referenced
- **THEN** that row's trash button is rendered visible but disabled

#### Scenario: Trash is disabled for the last workflow
- **WHEN** `workflow.list` reports a workflow as not deletable because it is the last one
- **THEN** that row's trash button is rendered visible but disabled

#### Scenario: Confirmed deletion calls workflow.delete
- **WHEN** the user clicks an enabled trash button, the confirmation dialog appears, and the user confirms
- **THEN** `workflow.delete` is called and the list refreshes

#### Scenario: Cancelling the confirmation makes no delete call
- **WHEN** the user opens the delete confirmation and dismisses it without confirming
- **THEN** `workflow.delete` is not called

### Requirement: Adding a workflow is Playwright-covered
The Playwright suite SHALL verify the name-only Add Workflow flow.

#### Scenario: Add Workflow opens a name-only dialog
- **WHEN** the user clicks "+ Add Workflow"
- **THEN** a dialog appears requesting only a name, with the submit action disabled while the name is empty

#### Scenario: Submitting creates and lists the workflow
- **WHEN** the user submits a name
- **THEN** `workflow.create` is called, the list refreshes, and the new workflow row appears

#### Scenario: A newly created workflow is immediately editable
- **WHEN** a new workflow row has appeared after creation
- **THEN** clicking its pencil button opens the workflow YAML editor overlay

### Requirement: The editor overlay lifecycle is Playwright-covered
The Playwright suite SHALL verify the editor overlay lifecycle and RPC wiring, without driving the Monaco text model.

#### Scenario: Pencil opens the overlay with the workflow name
- **WHEN** the user clicks a row's pencil button
- **THEN** the editor overlay opens, `workflow.getYaml` is called, and the overlay title shows the workflow name

#### Scenario: Save calls workflow.saveYaml and refreshes the list
- **WHEN** the user clicks Save in the editor overlay
- **THEN** `workflow.saveYaml` is called and the workflow list refreshes

#### Scenario: Cancel or Escape dismisses without saving
- **WHEN** the user clicks Cancel or presses Escape in the editor overlay
- **THEN** the overlay closes and `workflow.saveYaml` is not called

### Requirement: Board-header pencil removal and reload refresh are Playwright-covered
The Playwright suite SHALL verify the board header no longer exposes the workflow pencil and that the list reacts to the reload push event.

#### Scenario: The board header has no workflow pencil button
- **WHEN** a board is open in the board view
- **THEN** no workflow-edit pencil button is rendered in the board header

#### Scenario: A workflow.reloaded push refreshes the list
- **WHEN** a `workflow.reloaded` push event is delivered while the Workflows tab is open
- **THEN** the workflow list re-fetches
