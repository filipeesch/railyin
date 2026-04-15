## MODIFIED Requirements

### Requirement: Hunk ViewZone widgets are injected inline into Monaco after each changed block
The system SHALL inject hunk visualizations into the single CodeEditor for each pending diff hunk from the backend's `HunkWithDecisions[]` array. For each pending hunk, the system SHALL create: (1) a deletion ViewZone showing original lines (if `originalContentStart > 0`), positioned with `afterLineNumber` set to `hunk.modifiedContentStart - 1` (or `hunk.modifiedStart - 1` for pure deletions); (2) insertion ModelDecorations with green background on lines `modifiedContentStart` through `modifiedContentEnd` (if `modifiedContentStart > 0`); (3) an action bar ViewZone with a mounted `HunkActionBar` Vue component, positioned after the last modified line of the hunk. ViewZones for decided hunks (accepted/rejected) SHALL NOT be rendered. Change_request hunks SHALL render with a "decided" visual state.

#### Scenario: ViewZone appears after changed block
- **WHEN** a file is loaded in review mode and has pending hunks
- **THEN** each pending hunk has a deletion ViewZone (if applicable), green insertion decorations (if applicable), and an action bar ViewZone below the hunk's last modified line

#### Scenario: ViewZone removed on Accept
- **WHEN** the user clicks Accept on a hunk's action bar
- **THEN** the hunk's deletion ViewZone, insertion decorations, and action bar ViewZone are all removed instantly

#### Scenario: ViewZone removed on Reject
- **WHEN** the user clicks Reject on a hunk's action bar
- **THEN** all hunk visualizations are cleared and re-rendered from updated backend data after the file is reloaded

#### Scenario: ViewZone stays on Change Request
- **WHEN** the user clicks Change Request on a hunk's action bar
- **THEN** the deletion ViewZone and insertion decorations remain visible and the action bar transitions to a "decided" visual state

#### Scenario: Hunk visualizations rendered from backend data on file load
- **WHEN** a file is selected and `tasks.getFileDiff()` returns hunks
- **THEN** hunk visualizations are rendered directly from the backend hunk line ranges without client-side diff computation

### Requirement: ViewZone placement uses backend hunk line ranges directly
The system SHALL place ViewZones and ModelDecorations using the line ranges from the backend's `HunkWithDecisions` objects: `modifiedStart`, `modifiedEnd`, `modifiedContentStart`, `modifiedContentEnd`, `originalContentStart`, `originalContentEnd`. No correlation between Monaco `ILineChange` results and API hunk records is needed because the editor does not use Monaco's diff engine. One git hunk maps to exactly one set of visual elements (one deletion zone + one set of insertion decorations + one action bar zone).

#### Scenario: ViewZone placed using backend line ranges
- **WHEN** a pending hunk is rendered with `modifiedContentStart: 10` and `modifiedContentEnd: 15`
- **THEN** green insertion decorations cover lines 10-15 and the action bar ViewZone appears after line 15

#### Scenario: Deletion ViewZone placed above insertion point
- **WHEN** a hunk has both deletions (`originalContentStart: 8, originalContentEnd: 10`) and insertions (`modifiedContentStart: 8`)
- **THEN** the deletion ViewZone is positioned with `afterLineNumber: 7` (one line before the insertion starts)

#### Scenario: One hunk produces exactly one set of visual elements
- **WHEN** a file has 3 pending hunks from the backend
- **THEN** exactly 3 action bar ViewZones are created (not more, regardless of hunk content complexity)

### Requirement: Hunk zones and comment zones have independent lifecycles
The system SHALL maintain three separate Maps for ViewZone tracking: `deletionZones` (keyed by hunk hash), `actionBarZones` (keyed by hunk hash), and `commentZones` (keyed by comment ID). Hunk operations (accept, reject, file reload) SHALL only clear/modify `deletionZones` and `actionBarZones`. Comment zones SHALL only be cleared on file switch (before loading new file's comments) or overlay close. A `clearHunkVisuals(hash)` operation SHALL remove one hunk's deletion zone, action bar zone, and insertion decorations. A `clearAllHunkVisuals()` operation SHALL clear all hunk-related zones and decorations without affecting comment zones.

#### Scenario: Comment zones survive hunk accept
- **WHEN** a user has posted a comment on line 20 and accepts a hunk on lines 5-10
- **THEN** the comment zone on line 20 remains visible and functional

#### Scenario: Comment zones survive hunk reject and file reload
- **WHEN** a user has posted comments and rejects a hunk (triggering file reload)
- **THEN** comment zones are cleared and reloaded from the database via `loadLineComments()` for the same file

#### Scenario: Comment zones cleared on file switch
- **WHEN** the user switches to a different file in the file list
- **THEN** comment zones for the previous file are cleared and the new file's comments are loaded

#### Scenario: Hunk operations never clear comment zones
- **WHEN** `clearHunkVisuals()` or `clearAllHunkVisuals()` is called
- **THEN** the `commentZones` Map is not modified and all comment ViewZones remain in the editor

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
- **THEN** all HunkActionBar and LineCommentBar Vue app instances are unmounted before the Monaco editor is disposed

## REMOVED Requirements

### Requirement: ViewZone placement uses content-based correlation, not line-number-based
**Reason**: Content-based correlation between Monaco `ILineChange` and API hunks is no longer needed. The system no longer uses Monaco's DiffEditor or its diff computation. ViewZones are placed directly from backend hunk line ranges, which are canonical.
**Migration**: All zone placement uses `HunkWithDecisions` line range fields (`modifiedContentStart/End`, `originalContentStart/End`). The `ILineChange` type and correlation logic are removed.
