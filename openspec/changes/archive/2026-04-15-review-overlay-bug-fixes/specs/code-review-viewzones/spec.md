## MODIFIED Requirements

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

## ADDED Requirements

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
