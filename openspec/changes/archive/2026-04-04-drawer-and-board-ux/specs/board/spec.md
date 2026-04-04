## ADDED Requirements

### Requirement: Board drag-and-drop uses pointer events for cursor control
The system SHALL implement task card dragging using pointer events (not HTML5 Drag-and-Drop) so that the operating system DnD protocol is never invoked. During a drag, the cursor SHALL be `grabbing` and text selection SHALL be suppressed.

#### Scenario: Grabbing cursor shown while dragging
- **WHEN** a user presses and drags a task card beyond 5px of movement
- **THEN** the cursor changes to `grabbing` for the duration of the drag

#### Scenario: No text is selected while dragging
- **WHEN** a user begins pressing on a task card
- **THEN** text selection is immediately suppressed for the duration of the pointer gesture

#### Scenario: Card clone follows the cursor during drag
- **WHEN** a drag gesture is active
- **THEN** a cloned copy of the card element follows the cursor at the exact position where it was grabbed; the original card becomes transparent in place to preserve column layout

#### Scenario: Target column is highlighted during drag
- **WHEN** the cursor moves over a column while dragging a task card
- **THEN** that column gains a dashed outline to indicate it is the active drop target

#### Scenario: Task transitions on pointer release over a different column
- **WHEN** the user releases the pointer over a column different from the task's current column
- **THEN** the task transitions to that column

#### Scenario: Click is not fired after a drag
- **WHEN** the user drags and releases a task card
- **THEN** the task detail drawer does NOT open (click is suppressed within 200ms of drag end)
