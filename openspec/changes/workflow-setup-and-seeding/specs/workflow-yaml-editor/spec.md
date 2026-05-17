## REMOVED Requirements

### Requirement: Board header exposes a pencil button to edit the active workflow
**Reason**: Workflow editing moves out of the board header into the dedicated Workflows tab on the setup screen, which lists every workflow and offers a per-row edit action. A single pencil tied to the active board cannot manage workflows not currently shown on a board.
**Migration**: Edit a workflow from the setup screen's Workflows tab by clicking the pencil button on the workflow's row. The board header no longer contains a workflow-edit button.

## MODIFIED Requirements

### Requirement: Workflow YAML editor overlay displays and edits the template file
The system SHALL provide a full-screen overlay containing a Monaco editor pre-loaded with the raw YAML content of the workflow template selected from the Workflows tab. The overlay SHALL display the template name as its title, a close button, and Save / Cancel actions.

#### Scenario: Overlay loads the correct YAML
- **WHEN** the workflow YAML editor overlay opens from a workflow row's pencil button
- **THEN** the Monaco editor is populated with the raw YAML of that workflow's template file

#### Scenario: Overlay can be dismissed without saving
- **WHEN** the user clicks Cancel or presses Escape
- **THEN** the overlay closes and no changes are written to disk

#### Scenario: Overlay shows the template name as title
- **WHEN** the overlay is open
- **THEN** the title displays the workflow template's name (e.g. "Delivery Flow")
