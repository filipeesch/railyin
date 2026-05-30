## Purpose
Exposes a quick-access workflow editor directly from the board header, allowing users to edit the active board's workflow template without navigating to the Setup UI.

## Requirements

### Requirement: Board header exposes quick-access workflow editor
The board header SHALL display a pencil icon button immediately to the right of the board selector when a board is active. Clicking it SHALL open the `WorkflowEditorOverlay` pre-loaded with the YAML of the active board's workflow template. The overlay SHALL close automatically after a successful save. The button SHALL be hidden (not merely disabled) when no board is selected.

#### Scenario: Pencil button visible when a board is active
- **WHEN** a board is selected and the board view is shown
- **THEN** a pencil icon button appears immediately to the right of the board selector

#### Scenario: Pencil button hidden when no board is selected
- **WHEN** no board is active (empty board state)
- **THEN** the pencil button is not rendered in the board header

#### Scenario: Clicking pencil opens workflow editor for current board
- **WHEN** the user clicks the pencil button with a board active
- **THEN** the `WorkflowEditorOverlay` opens pre-loaded with the YAML of the active board's workflow template

#### Scenario: Overlay closes automatically after save
- **WHEN** the user saves the workflow in the overlay
- **THEN** the overlay closes automatically and the board columns reload to reflect the updated workflow

#### Scenario: Board columns reload after workflow save
- **WHEN** a workflow is saved from the board header editor
- **THEN** the board reloads its columns via the existing `workflow.reloaded` event without requiring a page refresh
