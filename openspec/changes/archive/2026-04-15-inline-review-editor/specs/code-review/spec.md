## MODIFIED Requirements

### Requirement: Code review overlay uses Monaco DiffEditor in inline mode by default with a side-by-side toggle
The system SHALL render a single `monaco.editor.create()` instance (standard code editor, not a DiffEditor) per selected file. The editor SHALL display the modified (working tree) version of the file as its model content. Diff visualization SHALL be rendered on top of the editor using three rendering primitives: (1) ViewZones showing deleted original lines with red background and strikethrough, positioned above the corresponding insertion point; (2) ModelDecorations highlighting inserted lines with green background; (3) ViewZones hosting HunkActionBar widgets below each pending hunk. The editor SHALL use `theme: "vs"` (light) and `automaticLayout: true`. Monaco SHALL be lazy-loaded via `@monaco-editor/loader` only when the review overlay first opens. There SHALL be no side-by-side toggle — the inline review is the only view mode.

#### Scenario: Inline review renders for a modified file
- **WHEN** a file with both insertions and deletions is selected in the review overlay
- **THEN** the editor shows the modified file content, with deleted original lines rendered in a red-background ViewZone above the insertion point, inserted lines highlighted with green background ModelDecorations, and a HunkActionBar ViewZone below each pending hunk

#### Scenario: Pure addition hunk renders without deletion zone
- **WHEN** a hunk has `originalContentStart === 0` and `originalContentEnd === 0` (pure addition)
- **THEN** only green background ModelDecorations appear on the inserted lines and an action bar ViewZone appears below, with no deletion ViewZone

#### Scenario: Pure deletion hunk renders without insertion decorations
- **WHEN** a hunk has `modifiedContentStart === 0` and `modifiedContentEnd === 0` (pure deletion)
- **THEN** only a red-background deletion ViewZone appears showing the original lines, with an action bar ViewZone below, and no green ModelDecorations

#### Scenario: New file shown with all lines as insertions
- **WHEN** a new file (not present in HEAD) is selected
- **THEN** the editor shows the file content with all lines decorated as insertions (green background) and no deletion ViewZones

#### Scenario: Deleted file shown with all lines as deletions
- **WHEN** a deleted file is selected
- **THEN** the editor shows an empty model with a deletion ViewZone containing all original lines

#### Scenario: Monaco not loaded until first overlay open
- **WHEN** the application starts and the review overlay has never been opened
- **THEN** Monaco is not loaded into the page

#### Scenario: No side-by-side toggle exists
- **WHEN** the review overlay is open
- **THEN** no view-toggle button is present in the header

### Requirement: Accepting a hunk collapses its diff in the display model
The system SHALL remove all visual diff elements for the accepted hunk when the user clicks Accept: the deletion ViewZone (red original lines), the insertion ModelDecorations (green background), and the action bar ViewZone SHALL all be removed. The editor model SHALL NOT be mutated — the modified content already represents the accepted state. The ViewZone and decoration removal SHALL be instant (no diff recompute).

#### Scenario: Accepted hunk disappears from diff
- **WHEN** the user accepts a hunk
- **THEN** the deletion ViewZone, green insertion decorations, and action bar ViewZone for that hunk are removed, leaving clean undecorated code

#### Scenario: Accepting does not mutate editor model
- **WHEN** the user accepts a hunk
- **THEN** the editor model text remains unchanged (it already contains the accepted content)

#### Scenario: Accepting does not affect other hunks
- **WHEN** the user accepts one hunk in a file with multiple pending hunks
- **THEN** all other hunks retain their deletion ViewZones, insertion decorations, and action bar ViewZones at their original positions

### Requirement: Rejecting a hunk collapses its diff in the display model
When the user rejects a hunk, the system SHALL call `tasks.rejectHunk()` RPC (which runs `git apply --reverse`), receive the updated `FileDiffContent` from the backend, set the editor model to the new modified text, and re-render all remaining hunk visualizations from the fresh backend data. All deletion ViewZones, insertion ModelDecorations, and action bar ViewZones SHALL be cleared and re-created from the updated hunk list.

#### Scenario: Rejected hunk disappears from diff
- **WHEN** the user rejects a hunk
- **THEN** the file content is reverted for that hunk, the editor reloads with updated content, and the rejected hunk's visual elements are absent

#### Scenario: Remaining hunks re-rendered at correct positions after reject
- **WHEN** a hunk is rejected and the file content changes (line numbers shift)
- **THEN** all remaining pending hunks are re-rendered at their correct (shifted) positions from the updated backend data

### Requirement: Deletion ViewZones show syntax-highlighted original text
The system SHALL render deleted original lines inside ViewZones with syntax highlighting using `monaco.editor.colorize(deletedText, language)`. The ViewZone SHALL initially render with plain monospace text and update to colorized HTML when the `colorize()` promise resolves. The deletion ViewZone SHALL use a red background, strikethrough text styling, and `word-wrap: off` with horizontal scroll for long lines.

#### Scenario: Deleted lines are syntax-highlighted
- **WHEN** a hunk with deletions is rendered and the colorize promise resolves
- **THEN** the deletion ViewZone displays syntax-highlighted original text with red background and strikethrough

#### Scenario: Colorize fallback to plain text
- **WHEN** `monaco.editor.colorize()` fails or times out
- **THEN** the deletion ViewZone displays plain monospace text with red background (no syntax highlighting)

### Requirement: Overlay header provides Prev/Next hunk navigation with pending counter
The system SHALL display Prev and Next navigation buttons in the overlay header along with a counter showing the number of pending (undecided) hunks across the current file. Clicking Next SHALL scroll the editor to the next pending hunk's `modifiedStart` line using `editor.revealLineInCenter()` and briefly highlight its action bar ViewZone. Clicking Prev SHALL do the same in reverse. Navigation SHALL skip accepted, rejected, and change_request hunks.

#### Scenario: Next navigates to next pending hunk
- **WHEN** the user clicks Next in the overlay header
- **THEN** the editor scrolls to center the next pending hunk's modified start line and highlights the action bar ViewZone

#### Scenario: Prev navigates to previous pending hunk
- **WHEN** the user clicks Prev in the overlay header
- **THEN** the editor scrolls to center the previous pending hunk's modified start line and highlights the action bar ViewZone

#### Scenario: Counter shows pending hunk count
- **WHEN** there are 3 pending hunks and 2 decided hunks in the current file
- **THEN** the counter displays "3 pending"

#### Scenario: Counter decrements on decision
- **WHEN** the user accepts or rejects a hunk
- **THEN** the pending counter decrements by one

## REMOVED Requirements

### Requirement: Code review overlay uses Monaco DiffEditor in inline mode by default with a side-by-side toggle
**Reason**: Replaced by inline review using a single standard CodeEditor. The DiffEditor's internal diff computation. and decoration ownership conflicts with per-hunk accept/reject. The single editor approach with manual diff visualization (ViewZones + ModelDecorations) eliminates these conflicts.
**Migration**: The new `InlineReviewEditor.vue` component replaces `MonacoDiffEditor.vue`. All review functionality is preserved with the same backend RPCs. Side-by-side mode is removed entirely.
