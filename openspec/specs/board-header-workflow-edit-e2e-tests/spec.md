## Purpose

Playwright E2E test coverage for the workflow-edit pencil button in the board header (`BoardView.vue`), verifying visibility rules, overlay open/close flow, and board-reload side-effect.

## Requirements

### Requirement: Board-header workflow edit button is covered by Playwright tests
Playwright tests SHALL verify the visibility rules, open-overlay flow, auto-close on save, and board-reload side-effect of the pencil button introduced in `BoardView.vue`.

#### Scenario: BWE-1 — pencil button is visible when a board is active
- **WHEN** the board view is shown with an active board
- **THEN** a button with accessible name matching `/edit workflow/i` is visible in the board header

#### Scenario: BWE-2 — pencil button is not rendered when no board is active
- **WHEN** the boards list returned by the API is empty (no active board)
- **THEN** no button matching `/edit workflow/i` exists in the board header

#### Scenario: BWE-3 — clicking pencil opens WorkflowEditorOverlay with correct template YAML
- **WHEN** the user clicks the pencil button and `workflow.getYaml` returns `{ yaml: "..." }` for the active board's `workflowTemplateId`
- **THEN** the `WorkflowEditorOverlay` becomes visible and its editor contains the returned YAML

#### Scenario: BWE-4 — saving in the overlay auto-closes it
- **WHEN** the user clicks Save in the `WorkflowEditorOverlay`
- **THEN** the overlay is no longer visible after the save RPC completes

#### Scenario: BWE-5 — saving triggers a boards.list reload
- **WHEN** the user saves the workflow in the overlay
- **THEN** a `boards.list` API call is made after the save (board columns reload)
