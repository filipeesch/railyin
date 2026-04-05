## MODIFIED Requirements

### Requirement: Code review overlay uses Monaco DiffEditor in inline mode by default with a side-by-side toggle
The system SHALL render a `monaco.editor.createDiffEditor` instance per selected file, configured with `renderSideBySide: false` (inline/unified mode) by default and `theme: "vs"` (light). The original content SHALL be the HEAD version of the file and the modified content SHALL be the current worktree version. A toggle button in the overlay header SHALL switch between inline and side-by-side modes; the current mode SHALL persist for the lifetime of the overlay session (not across sessions). Monaco SHALL be lazy-loaded via `@monaco-editor/loader` only when the review overlay first opens.

#### Scenario: Inline diff renders by default
- **WHEN** a file is selected in the review overlay
- **THEN** the Monaco editor renders in unified/inline mode (deleted lines in red, added lines in green, single-pane view) with a light `vs` theme

#### Scenario: Toggle switches to side-by-side
- **WHEN** the user clicks the view-toggle button in the overlay header
- **THEN** Monaco switches to `renderSideBySide: true` and the diff re-renders as a dual-pane view

#### Scenario: Toggle switches back to inline
- **WHEN** the user clicks the toggle again while in side-by-side mode
- **THEN** Monaco switches back to `renderSideBySide: false`

#### Scenario: New file shown with empty original
- **WHEN** a new file (not present in HEAD) is selected
- **THEN** the original side is empty and the modified side shows all lines as added

#### Scenario: Deleted file shown with empty modified
- **WHEN** a deleted file is selected
- **THEN** the original side shows all lines and the modified side is empty

#### Scenario: Monaco not loaded until first overlay open
- **WHEN** the application starts and the review overlay has never been opened
- **THEN** Monaco is not loaded into the page

### Requirement: Monaco DiffEditor fills the full overlay diff-panel height
The system SHALL size the Monaco DiffEditor using CSS flex layout so that it fills the entire available height of the diff panel — no fixed pixel height. The diff panel itself SHALL expand to fill the remaining height of the overlay after the header row.

#### Scenario: Editor fills available height
- **WHEN** the review overlay is open and a file is selected
- **THEN** the Monaco editor visually fills the full height of the diff panel area with no unused space below it

#### Scenario: Editor resizes with window resize
- **WHEN** the browser window is resized
- **THEN** the Monaco editor adapts its height via its `automaticLayout: true` configuration

### Requirement: Code review overlay has two modes: Changes and Review
The system SHALL open the overlay in **Changes mode** by default (read-only). In Changes mode, ViewZone widgets show the current decision as a read-only badge and are not interactive. A **"Start Review"** button in the header switches the overlay to **Review mode**, where ViewZone action bars become interactive (showing Accept / Reject / Change Request buttons and a comment textarea).

#### Scenario: Overlay opens in Changes mode
- **WHEN** the user clicks the changed-files badge
- **THEN** the overlay opens in Changes mode; any existing decisions are shown as read-only badges in the ViewZone widgets

#### Scenario: Switching to Review mode
- **WHEN** the user clicks "Start Review" in the overlay header
- **THEN** the overlay switches to Review mode and ViewZone widgets render the interactive action bar

### Requirement: Hunk action bar has always-visible comment textarea; comment required only for Change Request
Each hunk's inline action bar SHALL display a comment textarea at all times, regardless of the current decision state. The textarea SHALL be optional for Accept and Reject decisions, and SHALL be **required** (non-empty) for Change Request. If the user clicks Change Request without entering a comment, the textarea SHALL display a validation error and the decision SHALL NOT be saved until a comment is provided.

#### Scenario: Comment textarea visible in pending state
- **WHEN** a hunk ViewZone is rendered in Review mode with no decision yet
- **THEN** the comment textarea is visible and accepts optional input

#### Scenario: Accept saved with optional comment
- **WHEN** the user clicks Accept (with or without comment text)
- **THEN** the decision is saved with the comment (if any) and the hunk collapses

#### Scenario: Reject saved with optional comment
- **WHEN** the user clicks Reject (with or without comment text)
- **THEN** the decision is saved with the comment (if any) and the hunk collapses

#### Scenario: Change Request requires comment
- **WHEN** the user clicks Change Request with an empty comment textarea
- **THEN** the textarea shows a validation error and the decision is not saved

#### Scenario: Change Request saved with comment
- **WHEN** the user clicks Change Request with a non-empty comment
- **THEN** the decision is saved, the ViewZone transitions to a "decided" visual state, and the diff remains visible for that hunk

### Requirement: Accepting a hunk collapses its diff in the display model
The system SHALL maintain a mutable display model (separate from the API-returned original/modified strings). When the user accepts a hunk, the system SHALL replace the corresponding range in the display model's `original` with the `modified` lines for that hunk. The Monaco editor SHALL then be updated with the patched model, causing the accepted hunk's region to appear identical on both sides and disappear from the diff view. The ViewZone for that hunk SHALL be removed.

#### Scenario: Accepted hunk disappears from diff
- **WHEN** the user accepts a hunk
- **THEN** the changed lines vanish from the Monaco diff view and the surrounding code appears contiguous

### Requirement: Rejecting a hunk collapses its diff in the display model
When the user rejects a hunk, the system SHALL replace the corresponding range in the display model's `modified` with the `original` lines for that hunk. The Monaco editor SHALL then be updated with the patched model, causing the rejected hunk's region to appear identical on both sides and disappear from the diff view. The ViewZone for that hunk SHALL be removed. The worktree revert (`tasks.rejectHunk`) SHALL also be called to update the actual file on disk.

#### Scenario: Rejected hunk disappears from diff
- **WHEN** the user rejects a hunk
- **THEN** the changed lines vanish from the Monaco diff view (original content shown) and the file on disk is reverted for that hunk

### Requirement: Change Request keeps hunk diff visible with decided visual state
When the user submits a Change Request with a comment, the diff lines for that hunk SHALL remain visible in the Monaco editor (neither accept nor reject patching is applied). The ViewZone widget SHALL transition to a visual "decided" state indicating the request has been recorded. The hunk is excluded from the pending-hunk navigation counter.

#### Scenario: Change Request hunk stays in diff
- **WHEN** the user submits a Change Request on a hunk
- **THEN** the red/green diff lines remain visible and the ViewZone shows the submitted comment in a highlighted state

#### Scenario: Change Request hunk excluded from pending counter
- **WHEN** a hunk transitions to change_request state
- **THEN** the pending-hunk counter in the header decreases by one

### Requirement: Overlay header provides Prev/Next hunk navigation with pending counter
The system SHALL display Prev and Next navigation buttons in the overlay header along with a counter showing the number of pending (undecided) hunks across the current file. Clicking Next SHALL scroll Monaco to the next pending hunk and briefly highlight its ViewZone. Clicking Prev SHALL do the same in reverse. Navigation SHALL skip accepted, rejected, and change_request hunks.

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

### Requirement: Each diff hunk has a per-hunk decision persisted to SQLite
The system SHALL persist hunk decisions to the `task_hunk_decisions` table using a content-hash identity: `SHA-256(filePath + "\0" + originalLines + "\0" + modifiedLines)`. Each call to `tasks.setHunkDecision` is an upsert keyed by `(task_id, hunk_hash, reviewer_id)`. Decisions carry over across executions as long as the diff content is identical. When code changes produce a different hash, the prior decision no longer applies and the hunk is treated as `pending`.

State rules:
- `accepted`: display model patched (modified wins); ViewZone removed; excluded from submit message
- `rejected`: display model patched (original wins); ViewZone removed; worktree file reverted via `tasks.rejectHunk`; included in submit message with comment (or default "The user explicitly rejected this change.")
- `change_request`: no display model patch; ViewZone stays in "decided" state; diff remains visible; **required non-empty comment**; included in submit message
- `pending`: initial state; ViewZone shows interactive action bar; excluded from submit

#### Scenario: Decision persists across file switches
- **WHEN** the user accepts a hunk, switches to another file, then returns to the original file
- **THEN** the accepted hunk's diff is collapsed and its ViewZone is absent (decision was persisted)

#### Scenario: Decision persists across overlay close and reopen
- **WHEN** the user makes decisions, closes the overlay, and reopens it
- **THEN** previously decided hunks are shown in their decided state (collapsed for accept/reject, decided-badge for change_request)

#### Scenario: New diff hash invalidates old decision
- **WHEN** the model modifies a file such that a previously decided hunk's content changes
- **THEN** that hunk is treated as pending on next overlay open (new hash, no matching decision)
