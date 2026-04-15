## MODIFIED Requirements

### Requirement: Accepting a hunk collapses its diff in the display model
The system SHALL maintain a mutable display model (separate from the API-returned original/modified strings). When the user accepts a hunk, the system SHALL replace the corresponding range in the DiffEditor's **original model** with the modified lines for that hunk using `originalModel.pushEditOperations()`. Monaco's diff engine SHALL recalculate automatically, causing the accepted hunk's region to appear identical on both sides and disappear from the diff view. The ViewZone for that hunk SHALL be removed. No CSS decoration overlay (e.g. `accepted-hunk-decoration`) SHALL be applied — the diff elimination is achieved at the model level, not the presentation level.

#### Scenario: Accepted hunk disappears from diff
- **WHEN** the user accepts a hunk
- **THEN** the changed lines vanish from the Monaco diff view and the surrounding code appears contiguous

#### Scenario: Accepted hunk has no residual diff coloring
- **WHEN** the user accepts a hunk
- **THEN** Monaco's `.line-insert`, `.line-delete`, `.char-insert`, and `.char-delete` classes are absent for the accepted range because the diff engine finds no difference between original and modified for those lines

#### Scenario: Remaining hunks re-position correctly after accept
- **WHEN** an earlier hunk is accepted and the original model mutation shifts line numbers
- **THEN** Monaco fires `onDidUpdateDiff`, the system re-injects ViewZones for remaining pending hunks at their updated line positions

### Requirement: Rejecting a hunk collapses its diff in the display model
When the user rejects a hunk, the system SHALL replace the corresponding range in the DiffEditor's **modified model** with the original lines for that hunk. Monaco's diff engine SHALL recalculate automatically, causing the rejected hunk's region to appear identical on both sides and disappear from the diff view. The ViewZone for that hunk SHALL be removed. The worktree revert (`tasks.rejectHunk`) SHALL also be called to update the actual file on disk. No CSS decoration overlay (e.g. `rejected-hunk-decoration`) SHALL be applied.

#### Scenario: Rejected hunk disappears from diff
- **WHEN** the user rejects a hunk
- **THEN** the changed lines vanish from the Monaco diff view (original content shown) and the file on disk is reverted for that hunk

#### Scenario: Rejected hunk has no residual diff coloring
- **WHEN** the user rejects a hunk
- **THEN** Monaco's diff decoration classes are absent for the rejected range because the models are now identical for those lines

### Requirement: Overlay header provides Prev/Next hunk navigation with pending counter
The system SHALL display Prev and Next navigation buttons in the overlay header along with a counter showing the number of pending (undecided) hunks across the current file. Clicking Next SHALL scroll Monaco to the next pending hunk and briefly highlight its ViewZone. Clicking Prev SHALL do the same in reverse. Navigation SHALL skip accepted, rejected, and change_request hunks. When the last pending hunk in the current file is decided, the system SHALL automatically navigate to the next file that still has pending hunks rather than remaining on the fully-decided file.

#### Scenario: Next navigates to next pending hunk
- **WHEN** the user clicks Next in the overlay header
- **THEN** Monaco scrolls to and centers on the next pending hunk's ViewZone

#### Scenario: Prev navigates to previous pending hunk
- **WHEN** the user clicks Prev in the overlay header
- **THEN** Monaco scrolls to and centers on the previous pending hunk's ViewZone

#### Scenario: Counter shows pending hunk count
- **WHEN** there are 3 pending hunks and 2 decided hunks in the current file
- **THEN** the counter displays "3 pending"

#### Scenario: Counter decrements on decision
- **WHEN** the user accepts or rejects a hunk
- **THEN** the pending counter decrements by one

#### Scenario: Last pending hunk decided advances to next pending file
- **WHEN** the user decides the last pending hunk in the current file and other files still have pending hunks
- **THEN** the overlay automatically selects the next file with pending hunks and loads its diff

## ADDED Requirements

### Requirement: Line comment creation via gutter indicator with selection-aware range
The system SHALL display a "+" indicator in the editor's line decoration gutter (via `linesDecorationsClassName`) on the hovered line when the overlay is in Review mode. Clicking the "+" SHALL create a line comment. If the editor has an active multi-line text selection at the time of click, the comment SHALL span the selected line range. If no multi-line selection exists, the comment SHALL apply to the single clicked line. A dotted border decoration SHALL indicate the commentable range when a multi-line selection is active.

#### Scenario: Plus indicator appears on hover
- **WHEN** the user hovers over a line in the modified editor in Review mode
- **THEN** a "+" indicator appears in the line decoration gutter for the hovered line

#### Scenario: Single-line comment on click without selection
- **WHEN** the user clicks the "+" indicator with no active multi-line selection
- **THEN** a comment zone opens for that single line

#### Scenario: Multi-line comment on click with selection
- **WHEN** the user selects lines 10–15 and clicks the "+" indicator
- **THEN** a comment zone opens spanning lines 10–15

#### Scenario: No indicator in Changes mode
- **WHEN** the overlay is in Changes mode (not Review mode)
- **THEN** no "+" indicator appears on hover
