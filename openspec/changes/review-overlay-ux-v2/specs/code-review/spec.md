## MODIFIED Requirements (Bug Fixes)

### Requirement: File list shows aggregate decision state per file
**Bug**: `ReviewFileList` defines the `aggregateStates` prop and `stateIcon()` function, but `CodeReviewOverlay` never computes or passes the prop — every file shows the default state regardless of hunk decisions.

The system SHALL derive and display an aggregate decision state for each file in the file list based on its hunks' individual decisions. The state SHALL be displayed as a flat CSS dot indicator (8px circle) next to the file name, not emoji icons.

Aggregation rules (in priority order):
- Any hunk `rejected` → file shows `rejected` (filled red dot)
- Any hunk `change_request` (and no rejections) → file shows `change_request` (filled amber dot)
- All hunks `accepted` → file shows `accepted` (filled green dot)
- Otherwise → file shows `pending` (outline gray dot)

The aggregate state map SHALL be computed in `CodeReviewOverlay` and passed to `ReviewFileList` as the `aggregateStates` prop. The map SHALL update when hunks are decided and when files are loaded.

#### Scenario: File with mixed decisions shows dominant state
- **WHEN** a file has one accepted hunk and one change_request hunk
- **THEN** the file list shows an amber filled dot for that file

#### Scenario: File with any rejection shows rejected indicator
- **WHEN** a file has one change_request hunk and one rejected hunk
- **THEN** the file list shows a red filled dot regardless of other decisions

#### Scenario: All-accepted file shows accepted indicator
- **WHEN** all hunks in a file are accepted
- **THEN** the file list shows a green filled dot for that file

#### Scenario: Pending file shows outline dot
- **WHEN** a file has pending (undecided) hunks
- **THEN** the file list shows a gray outline dot for that file

#### Scenario: Unvisited files default to pending dot
- **WHEN** a file has never been loaded during the current overlay session
- **THEN** the file list shows a gray outline dot (pending) for that file

### Requirement: Submit sends structured code_review message to the model
**Bug**: `onSubmit()` always sends a `code_review` message to the LLM, even when all hunks are accepted with no comments or manual edits, wasting tokens on a no-op payload.

The system SHALL provide a Submit Review button in the overlay (visible only in Review mode). On submit, the system SHALL check for two special cases before sending:

1. **All accepted with no actionable items**: If all hunks across loaded files are accepted AND there are no line comments AND no manual edits, the system SHALL close the review silently without sending any message.

2. **Pending hunks remain**: If any hunks remain in pending state across any file, the system SHALL show a PrimeVue `Dialog` confirming intent: "Some hunks are still pending. Submit your reviewed items?" with Cancel and Submit Anyway buttons. Only on confirmation SHALL the submit proceed.

When submitting:
1. Send `{ _type: "code_review", manualEdits }` via `tasks.sendMessage`
2. The backend reads all human decisions from `task_hunk_decisions` for the task and builds the `CodeReviewPayload`
3. Create a `"code_review"` ConversationMessage with JSON content containing the full decision set
4. Inject a plain-text user-role message to the LLM summarizing only the actionable items
5. Trigger a new execution in the task's current column with its existing toolset
6. Close the review overlay

The Submit button SHALL be disabled if any `change_request` hunk is missing a required comment.

#### Scenario: Submit with only accepted hunks and no comments
- **WHEN** all hunks across all loaded files are accepted, there are no line comments, and no manual edits
- **THEN** the review overlay closes silently without sending a message to the model

#### Scenario: Submit with pending hunks shows confirmation dialog
- **WHEN** the user clicks Submit and some hunks remain in pending state
- **THEN** a PrimeVue Dialog appears asking "Some hunks are still pending. Submit your reviewed items?"

#### Scenario: Confirming partial submit sends message
- **WHEN** the user clicks "Submit Anyway" in the confirmation dialog
- **THEN** the code_review message is sent with rejected, change_request, line comments, and manual edits

#### Scenario: Cancelling partial submit returns to overlay
- **WHEN** the user clicks "Cancel" in the confirmation dialog
- **THEN** the dialog closes and the overlay remains open

#### Scenario: Submit with rejected and change_request items
- **WHEN** the user submits with some rejected and change_request hunks
- **THEN** the model receives a structured user message listing only the rejected and change_request items with their comments

#### Scenario: Submit button disabled with incomplete change_request
- **WHEN** one or more hunks are in change_request state without a saved comment
- **THEN** the Submit button is disabled

#### Scenario: Overlay closes after submit
- **WHEN** the user submits the review (directly or via confirmation)
- **THEN** the overlay closes and the task's conversation shows a new code_review message

## MODIFIED Requirements (UX Changes)

### Requirement: Accepting a hunk does not auto-navigate
The system SHALL remove all visual diff elements for the accepted hunk when the user clicks Accept: the deletion ViewZone, the insertion ModelDecorations, and the action bar ViewZone SHALL all be removed. The editor SHALL NOT auto-scroll to the next pending hunk or auto-navigate to the next file after an accept decision. The user SHALL control navigation explicitly via the Prev/Next buttons in the overlay header.

#### Scenario: Accepted hunk disappears from diff
- **WHEN** the user accepts a hunk
- **THEN** the deletion ViewZone, green insertion decorations, and action bar ViewZone for that hunk are removed, leaving clean undecorated code

#### Scenario: No auto-scroll after accept
- **WHEN** the user accepts a hunk and other pending hunks remain in the file
- **THEN** the editor scroll position does not change automatically

#### Scenario: No auto-file-navigation after last hunk accept
- **WHEN** the user accepts the last pending hunk in a file
- **THEN** the selected file does not change automatically; the user remains on the current file

### Requirement: LLM payload includes column-precise comment selection
The `formatReviewMessageForLLM` function SHALL emit column-precise range indicators and the exact selected text for line comments that have column data. When `colStart > 0`, the format SHALL be `L{lineStart}:C{colStart}–C{colEnd}` with the selection text shown verbatim in backtick wrapping. When `colStart = 0`, the format SHALL fall back to the current line-range format.

#### Scenario: Column-precise comment in payload
- **WHEN** a posted comment has colStart=19 and colEnd=45 on line 4
- **THEN** the LLM payload shows `L4:C19–C45` with `Selection: \`processData(input, options)\``

#### Scenario: Full-line comment in payload
- **WHEN** a posted comment has colStart=0 and colEnd=0
- **THEN** the LLM payload shows the current line-range format without column indicators

## ADDED Requirements

### Requirement: Line comments support column-precise selection ranges
The system SHALL store column-precise selection ranges for line comments via `col_start` and `col_end` integer columns in `task_line_comments`. When `col_start = 0 AND col_end = 0`, the comment applies to full lines (backward compatible). When both are non-zero, the comment applies to the exact character range within the line(s). The `tasks.addLineComment` RPC SHALL accept optional `colStart` and `colEnd` parameters. The `tasks.getLineComments` RPC SHALL return `colStart` and `colEnd` for each comment.

#### Scenario: Column-precise comment stored with range
- **WHEN** the user selects text from line 4, column 19 to line 4, column 45 and posts a comment
- **THEN** `task_line_comments` row has `col_start=19, col_end=45, line_start=4, line_end=4`

#### Scenario: Full-line comment stored with col defaults
- **WHEN** the user posts a comment on line 7 without column selection
- **THEN** `task_line_comments` row has `col_start=0, col_end=0, line_start=7, line_end=7`

#### Scenario: Multi-line column range stored
- **WHEN** the user selects from L4:C19 to L7:C12 and posts a comment
- **THEN** `task_line_comments` row has `line_start=4, line_end=7, col_start=19, col_end=12`

### Requirement: Test suites use click-by-click assertions and full content checks
All review overlay test suites SHALL assert state after each individual UI action rather than batching multiple actions before a single assertion. File content assertions SHALL compare the complete file text (not partial string matches). Message content assertions SHALL compare the full message payload structure and text. This applies to both existing test retrofits and new feature tests.

#### Scenario: Click-by-click assertion pattern
- **WHEN** a test performs Accept on hunk 1, then Accept on hunk 2
- **THEN** the test asserts the expected state after hunk 1's Accept before proceeding to hunk 2's Accept

#### Scenario: Full file content assertion
- **WHEN** a test asserts the resulting file after review decisions
- **THEN** the assertion compares the entire file content string, not a substring or line count

#### Scenario: Full message content assertion
- **WHEN** a test asserts the code_review message sent to the model
- **THEN** the assertion compares the complete message payload including all fields, not just fragments
