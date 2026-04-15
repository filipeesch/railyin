## Purpose
ViewZone widgets are DOM-based overlays injected inline into the Monaco DiffEditor after each diff hunk. Each widget hosts a mounted `HunkActionBar` Vue component that renders hunk decisions (accept / reject / change request) directly inside the editor's line space, appearing immediately beneath the changed lines.
## Requirements
### Requirement: Hunk ViewZone widgets are injected inline into Monaco after each changed block
The system SHALL inject a DOM-based ViewZone widget into the Monaco editor after the last modified line of each diff hunk. Each ViewZone widget SHALL be a mounted `HunkActionBar` Vue component instance rendered inside the Monaco editor's line-space, appearing directly beneath the changed lines. ViewZones SHALL be managed through Monaco's `editor.changeViewZones()` API and SHALL be removed when a hunk receives an Accept or Reject decision. Hunk ViewZones and comment ViewZones SHALL have separate lifecycle management — clearing hunk ViewZones (e.g. on diff refresh, model mutation, or view mode toggle) SHALL NOT destroy comment ViewZones.

#### Scenario: ViewZone appears after changed block
- **WHEN** a file is loaded in review mode and has pending hunks
- **THEN** a ViewZone action bar appears in the editor immediately after the last modified line of each pending hunk

#### Scenario: ViewZone removed on Accept
- **WHEN** the user clicks Accept on a hunk's ViewZone action bar
- **THEN** the ViewZone is removed and the diff collapses for that hunk's line range

#### Scenario: ViewZone removed on Reject
- **WHEN** the user clicks Reject on a hunk's ViewZone action bar
- **THEN** the ViewZone is removed and the diff collapses for that hunk's line range

#### Scenario: ViewZone stays on Change Request
- **WHEN** the user clicks Change Request on a hunk's ViewZone action bar
- **THEN** the ViewZone remains visible with the diff lines intact and transitions to a "decided" visual state

#### Scenario: ViewZone re-injected after model mutation
- **WHEN** a decision mutates the original or modified model and triggers a diff recompute
- **THEN** all remaining pending-hunk ViewZones are re-injected at their correct (shifted) positions after `onDidUpdateDiff` fires

#### Scenario: Hunk zone clearing does not destroy comment zones
- **WHEN** a diff refresh or hunk decision triggers hunk ViewZone clearing
- **THEN** comment ViewZones remain visible and functional

### Requirement: ViewZone placement uses content-based correlation, not line-number-based
The system SHALL correlate Monaco `ILineChange` results with API hunk records by matching the actual text content of changed lines against the stored `originalLines` and `modifiedLines` of each API hunk. Line numbers from the API response SHALL NOT be used for ViewZone placement after any hunk decisions have been applied to the display model.

#### Scenario: ViewZone placed correctly after prior hunk collapses shift lines
- **WHEN** an earlier hunk in the file has been accepted (collapsing 2 lines) and a later hunk is still pending
- **THEN** the pending hunk's ViewZone is placed at the correct (shifted) line position in the editor, not at the original API line number

#### Scenario: Content match used for placement
- **WHEN** Monaco's `getLineChanges()` returns an ILineChange and the system maps it to an API hunk
- **THEN** the mapping is done by comparing the textual content of the changed lines, not by line number equality

### Requirement: ViewZone height updates dynamically as comment textarea grows
The system SHALL use a `ResizeObserver` on each ViewZone's DOM node to detect height changes (caused by comment textarea auto-resize). On height change, the system SHALL call `editor.changeViewZones(accessor => accessor.layoutZone(zoneId))` to update Monaco's internal line-offset accounting for that zone.

#### Scenario: Zone expands when comment is typed
- **WHEN** the user types a multi-line comment in a ViewZone's textarea
- **THEN** the ViewZone height increases and the code lines below it shift down accordingly in the editor

### Requirement: Keyboard events within ViewZone DOM are isolated from Monaco
The system SHALL call `stopPropagation()` on all `keydown`, `keyup`, and `keypress` events originating from within a ViewZone's DOM subtree. This prevents Monaco from intercepting keystrokes intended for the textarea.

#### Scenario: Typing in textarea does not move Monaco cursor
- **WHEN** the user clicks inside a ViewZone textarea and types text including arrow keys or Escape
- **THEN** Monaco does not respond to those keystrokes (cursor does not move, no Monaco shortcuts fire)

### Requirement: ViewZone Vue app instances are unmounted on editor disposal
The system SHALL track all mounted Vue app instances created for ViewZone widgets. When the Monaco editor is disposed (overlay close or file change), the system SHALL call `app.unmount()` on each tracked instance before disposing the editor.

#### Scenario: No memory leak on overlay close
- **WHEN** the review overlay is closed while ViewZone widgets are active
- **THEN** all HunkActionBar Vue app instances are unmounted before the Monaco editor is disposed

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

### Requirement: Comment ViewZones persist across file switches
The system SHALL manage comment ViewZones separately from hunk ViewZones. When the user switches to a different file and then returns, the system SHALL reload comment zones from the persisted comment data via `loadLineComments()`. The diff-refresh path (`loadDiff`) SHALL NOT clear comment zones — only the file-switch entry point SHALL clear the previous file's comment zones before loading the new file's comments.

#### Scenario: Comments survive file round-trip
- **WHEN** the user adds a comment on file A, switches to file B, then returns to file A
- **THEN** the comment on file A is visible (reloaded from persisted data)

#### Scenario: Diff refresh does not destroy comments
- **WHEN** a hunk decision triggers a diff refresh on the current file
- **THEN** existing comment ViewZones remain visible and are not cleared

#### Scenario: File switch clears previous file comments before loading new ones
- **WHEN** the user switches from file A to file B
- **THEN** file A's comment ViewZones are cleared and file B's comments are loaded from persisted data

