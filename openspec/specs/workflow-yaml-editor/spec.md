## Purpose
The workflow YAML editor allows users to edit workflow template configuration files directly from the board UI, without leaving the app or editing files manually on disk.

## Requirements

### Requirement: Board header exposes a pencil button to edit the active workflow
The system SHALL render a pencil (edit) icon button in the board header, immediately to the right of the board selector dropdown. The button SHALL be disabled when no board is active. Clicking it SHALL open the workflow YAML editor overlay for the active board's workflow template.

#### Scenario: Pencil button is visible when a board is active
- **WHEN** the user has an active board selected
- **THEN** a pencil icon button appears to the right of the board selector in the board header

#### Scenario: Pencil button is disabled with no active board
- **WHEN** no board is selected
- **THEN** the pencil button is rendered as disabled and non-interactive

#### Scenario: Clicking the pencil button opens the editor overlay
- **WHEN** the user clicks the pencil button
- **THEN** the workflow YAML editor overlay opens, pre-loaded with the raw YAML of the active board's workflow template

### Requirement: Workflow YAML editor overlay displays and edits the template file
The system SHALL provide a full-screen overlay containing a Monaco editor pre-loaded with the raw YAML content of the active board's workflow template. The overlay SHALL display the template name as its title, a close button, and Save / Cancel actions.

#### Scenario: Overlay loads the correct YAML
- **WHEN** the workflow YAML editor overlay opens
- **THEN** the Monaco editor is populated with the raw YAML of the active board's workflowTemplateId file

#### Scenario: Overlay can be dismissed without saving
- **WHEN** the user clicks Cancel or presses Escape
- **THEN** the overlay closes and no changes are written to disk

#### Scenario: Overlay shows the template name as title
- **WHEN** the overlay is open
- **THEN** the title displays the workflow template's name (e.g. "Delivery Flow")

### Requirement: YAML editor validates syntax before allowing save
The system SHALL parse the editor content with a YAML parser on every change. If the content is valid YAML, the Save button SHALL be enabled and a valid indicator shown. If the content is invalid YAML, the Save button SHALL be disabled and an error message SHALL be shown.

#### Scenario: Valid YAML enables the Save button
- **WHEN** the editor content parses as valid YAML
- **THEN** the Save button is enabled and the UI shows a "Valid YAML" indicator

#### Scenario: Invalid YAML disables the Save button
- **WHEN** the editor content contains a YAML syntax error
- **THEN** the Save button is disabled and a descriptive parse error message is shown

### Requirement: Saving writes the YAML to disk and reloads the board
The system SHALL send the edited YAML to the backend via the `workflow.saveYaml` RPC. On success, the frontend SHALL re-fetch the boards list and update the board columns without a full app restart.

#### Scenario: Successful save reloads the board columns
- **WHEN** the user clicks Save and the backend confirms success
- **THEN** the overlay closes, the board columns update to reflect any changes in the saved YAML, and no app restart is required

#### Scenario: Save is rejected if backend parse fails
- **WHEN** the backend rejects the YAML (invalid structure)
- **THEN** the overlay remains open and displays the error returned by the backend

#### Scenario: Save button shows loading state
- **WHEN** the save RPC call is in flight
- **THEN** the Save button shows a loading indicator and is non-interactive

### Requirement: workflow.getYaml RPC returns the raw YAML for a template
The system SHALL expose a `workflow.getYaml` RPC endpoint that accepts a `templateId` and returns the raw UTF-8 string content of the corresponding `config/workflows/<templateId>.yaml` file.

#### Scenario: getYaml returns file content for a known template
- **WHEN** `workflow.getYaml` is called with a valid templateId
- **THEN** the response contains the raw YAML string of that template file

#### Scenario: getYaml returns an error for an unknown template
- **WHEN** `workflow.getYaml` is called with a templateId whose file does not exist
- **THEN** the RPC returns an error response

### Requirement: workflow.saveYaml RPC validates, writes, and reloads config
The system SHALL expose a `workflow.saveYaml` RPC endpoint that accepts a `templateId` and `yaml` string. It SHALL parse the YAML before writing. If valid, it SHALL overwrite the corresponding file on disk and trigger an in-memory config reload. It SHALL then broadcast a `workflow.reloaded` event to the frontend.

#### Scenario: saveYaml writes valid YAML to disk
- **WHEN** `workflow.saveYaml` is called with a templateId and valid YAML string
- **THEN** the file `config/workflows/<templateId>.yaml` is overwritten with the new content and the config is reloaded in memory

#### Scenario: saveYaml rejects invalid YAML
- **WHEN** `workflow.saveYaml` is called with content that fails YAML parsing
- **THEN** the file is NOT written and an error is returned

#### Scenario: saveYaml broadcasts workflow.reloaded after success
- **WHEN** `workflow.saveYaml` succeeds
- **THEN** a `workflow.reloaded` IPC event is sent to the frontend so it can refresh board data
