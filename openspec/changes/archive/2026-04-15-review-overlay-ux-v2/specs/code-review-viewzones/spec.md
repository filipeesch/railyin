## MODIFIED Requirements (Bug Fix)

### Requirement: Hunk ViewZone widgets are injected inline into Monaco after each changed block
**Bug**: The gutter-based comment button uses `MouseTargetType === 2` (`GUTTER_LINE_DECORATIONS`) — a 14px-wide strip that rarely registers hover across browsers and zoom levels, making comments effectively undiscoverable for most users.

The system SHALL inject ViewZone widgets into the Monaco editor for each changed block (hunk). Each hunk SHALL have:

1. **Deletion ViewZone**: Displays deleted lines in a read-only mini-editor above the hunk's new code.
2. **Action bar ViewZone**: Displays Accept / Change Request / Reject buttons below the deletion zone.
3. **Comment ViewZone**: When a comment is active, displays a textarea below the action bar for entering review comments.

The gutter-based comment button ("+" icon in line number margin) SHALL be fully removed from the system. Instead, a floating comment button SHALL appear above the user's text selection (see ADDED requirement "Floating comment button on text selection").

#### Scenario: Hunk renders with deletion zone and action bar
- **WHEN** a file with changes is loaded
- **THEN** each changed hunk shows a deletion ViewZone (rendered with red-tinted background) and an action bar ViewZone below it

#### Scenario: Comment ViewZone opens from floating button
- **WHEN** the user clicks the floating comment button above a text selection
- **THEN** a comment ViewZone appears at the selected line, pre-populated with column range context

#### Scenario: No gutter comment decorations
- **WHEN** a file with changes is loaded for review
- **THEN** no gutter "+" icons or hover targets appear in the line number area

## ADDED Requirements

### Requirement: Floating comment button on text selection
The system SHALL display a floating comment button when the user selects text in the Monaco editor during review mode. The button SHALL appear above the selection start position, offset 4px upward. The button SHALL be a semi-transparent rounded button with a comment icon. When clicked, it SHALL open a comment ViewZone at the selection's start line, pre-populating the column range (`colStart`, `colEnd`) from the selection boundaries.

Implementation details:
- Use `editor.onDidChangeCursorSelection` to detect selection (non-collapsed only)
- Use `editor.getScrolledVisiblePosition` to compute DOM coordinates
- Attach the button element to the editor's overlay DOM container
- Hide the button on scroll end, selection collapse, or Escape key

#### Scenario: Text selection shows floating button
- **WHEN** the user selects text spanning columns 19 to 45 on line 4
- **THEN** a floating comment button appears above the selection

#### Scenario: Collapsed cursor hides button
- **WHEN** the user clicks without dragging (collapsed selection)
- **THEN** no floating button is displayed

#### Scenario: Clicking floating button opens comment with column range
- **WHEN** the user clicks the floating comment button after selecting L4:C19–C45
- **THEN** a comment ViewZone opens at line 4 with colStart=19 and colEnd=45 pre-set

#### Scenario: Scrolling hides floating button
- **WHEN** the editor scrolls while the floating button is visible
- **THEN** the floating button is hidden until a new selection is made

### Requirement: Inline amber highlight on posted comments
The system SHALL render inline text highlights for posted comments that have column-precise ranges. The highlight SHALL be applied as a Monaco `inlineClassName` decoration with a semi-transparent amber background (`rgba(250, 204, 21, 0.15)` in light mode, `rgba(250, 204, 21, 0.10)` in dark mode). The decorations SHALL use `TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges` to maintain their position. Full-line comments (colStart=0, colEnd=0) SHALL not render an inline highlight.

#### Scenario: Column-precise comment shows amber highlight
- **WHEN** a posted comment exists with colStart=19 and colEnd=45 on line 4
- **THEN** characters 19–45 on line 4 are highlighted with amber background

#### Scenario: Full-line comment has no inline highlight
- **WHEN** a posted comment has colStart=0 and colEnd=0
- **THEN** no inline text highlight decoration is applied

#### Scenario: Multiple comments show multiple highlights
- **WHEN** the file has three posted comments with column ranges
- **THEN** three independent amber highlight decorations are visible

### Requirement: Click highlight to toggle comment ViewZone
The system SHALL allow the user to click an amber-highlighted range to open or close the associated comment ViewZone. When a comment ViewZone is not visible, clicking the highlight SHALL open it (scrolling to it if needed). When the comment ViewZone is already visible, clicking the highlight SHALL close it. The user SHALL be able to edit or delete the comment from the opened ViewZone.

#### Scenario: Click highlight opens comment
- **WHEN** a posted comment's amber highlight is clicked and the comment ViewZone is not visible
- **THEN** the comment ViewZone opens at that line, showing the existing comment text

#### Scenario: Click highlight closes comment
- **WHEN** a posted comment's amber highlight is clicked and the comment ViewZone is already visible
- **THEN** the comment ViewZone closes

#### Scenario: Edit comment from opened ViewZone
- **WHEN** the user opens a comment ViewZone via highlight click and edits the text
- **THEN** the comment is updated via `tasks.updateLineComment` RPC on save
