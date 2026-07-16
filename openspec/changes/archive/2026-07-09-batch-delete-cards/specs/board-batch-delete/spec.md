## ADDED Requirements

### Requirement: Board topbar provides a batch delete entry point
The board view SHALL provide a topbar button that enters card selection mode.

#### Scenario: Delete button visible on board
- **WHEN** the user views a board with at least one card
- **THEN** the topbar shows a delete button with a trash icon

#### Scenario: First click enters selection mode
- **WHEN** the user clicks the topbar delete button
- **THEN** the board enters selection mode and each card renders a checkbox

### Requirement: Cards can be selected and deselected in selection mode
The system SHALL allow the user to toggle a card's selection by clicking the card body while selection mode is active.

#### Scenario: Clicking a card selects it
- **WHEN** the user clicks an unselected card in selection mode
- **THEN** the card becomes selected and its checkbox is checked

#### Scenario: Clicking a selected card deselects it
- **WHEN** the user clicks a selected card in selection mode
- **THEN** the card becomes unselected and its checkbox is unchecked

#### Scenario: Card click does not open detail drawer in selection mode
- **WHEN** the user clicks a card while selection mode is active
- **THEN** the task detail drawer does NOT open

### Requirement: Selection mode exposes delete and cancel actions
The system SHALL show a delete action for the current selection and a cancel action to exit selection mode without deleting.

#### Scenario: Delete N button shows selected count
- **WHEN** the user has selected N cards in selection mode
- **THEN** the topbar shows a "Delete N" button with the current count

#### Scenario: Delete N button disabled with empty selection
- **WHEN** selection mode is active but no cards are selected
- **THEN** the "Delete N" button is disabled

#### Scenario: Cancel button exits selection mode
- **WHEN** the user clicks the Cancel button in selection mode
- **THEN** selection mode exits, all selections are cleared, and checkboxes disappear

### Requirement: Batch delete requires confirmation
The system SHALL confirm before deleting selected cards.

#### Scenario: Delete N opens confirmation dialog
- **WHEN** the user clicks the "Delete N" button
- **THEN** a confirmation dialog appears showing the number of cards to delete

#### Scenario: Confirming deletes selected cards
- **WHEN** the user confirms the deletion dialog
- **THEN** each selected card is removed from the board by calling `tasks.delete`

#### Scenario: Cancelling dialog keeps selection mode
- **WHEN** the user cancels the deletion dialog
- **THEN** the dialog closes, selection mode remains active, and selected cards stay selected

### Requirement: Selection mode resets on context change
The system SHALL clear selection mode when the user leaves the current board context.

#### Scenario: Board change resets selection
- **WHEN** the user switches to a different board
- **THEN** selection mode exits and selected IDs are cleared

#### Scenario: Workspace change resets selection
- **WHEN** the user switches to a different workspace
- **THEN** selection mode exits and selected IDs are cleared

### Requirement: Batch delete reports partial progress
The system SHALL report per-card deletion progress so the UI can reflect which cards have already been processed.

#### Scenario: onProgress callback fires after each deletion
- **WHEN** the frontend calls `taskStore.deleteTasks` with multiple task IDs
- **THEN** the optional `onProgress` callback is invoked with each deleted task ID in order
