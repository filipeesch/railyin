## Purpose
ViewZone widgets are DOM-based overlays injected inline into the Monaco DiffEditor after each diff hunk. Each widget hosts a mounted `HunkActionBar` Vue component that renders hunk decisions (accept / reject / change request) directly inside the editor's line space, appearing immediately beneath the changed lines.

## Requirements

### Requirement: Hunk ViewZone widgets are injected inline into Monaco after each changed block
The system SHALL inject a DOM-based ViewZone widget into the Monaco editor after the last modified line of each diff hunk. Each ViewZone widget SHALL be a mounted `HunkActionBar` Vue component instance rendered inside the Monaco editor's line-space, appearing directly beneath the changed lines. ViewZones SHALL be managed through Monaco's `editor.changeViewZones()` API and SHALL be removed when a hunk receives an Accept or Reject decision.

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

#### Scenario: ViewZone re-injected after model swap
- **WHEN** a decision collapses one hunk and triggers a Monaco model swap
- **THEN** all remaining pending-hunk ViewZones are re-injected at their correct (shifted) positions after the model swap completes

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
