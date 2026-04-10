## Purpose
Code review is the workflow for a human reviewer to inspect, accept, or reject changes made by the model before they are committed. The reviewer opens a full-screen overlay showing a side-by-side Monaco diff for each changed file, applies per-hunk decisions, and submits structured feedback that is injected into the task's conversation as a new model execution.

## Requirements

### Requirement: Changed files badge shown when worktree has uncommitted changes
The system SHALL display a changed-files badge on a task card and in the task detail drawer header whenever `git diff HEAD --name-only --diff-filter=ACDMR` returns a non-empty result for the task's worktree. The badge SHALL show the count of changed files. The badge SHALL update whenever a `file_diff` IPC message is received for the task, when a `task.updated` event arrives with `executionState: "completed"`, when the task detail drawer opens for a ready worktree, or when the user clicks the sync button in the drawer header or the Refresh button in the overlay.

#### Scenario: Badge appears when files are changed
- **WHEN** the model writes a file and a `file_diff` IPC message is received for the task
- **THEN** `tasks.getChangedFiles` is called and the badge shows the returned file count

#### Scenario: Badge absent when worktree is clean
- **WHEN** `tasks.getChangedFiles` returns an empty array for the task
- **THEN** no badge is shown on the task card or in the drawer header

#### Scenario: Badge updates after review-based revert
- **WHEN** a reviewer rejects a hunk (reverting a file) and the review overlay closes
- **THEN** `tasks.getChangedFiles` is called again and the badge updates to reflect the new file count

#### Scenario: Badge count refreshed on drawer open
- **WHEN** the task detail drawer opens for a task with `worktreeStatus: 'ready'`
- **THEN** `tasks.getChangedFiles` is called automatically and the badge reflects the current count

### Requirement: Code review overlay opens from the changed-files badge
The system SHALL open a full-screen code review overlay when the user clicks the changed-files badge on a task card or in the task detail drawer header. The overlay SHALL be column-agnostic — it appears for any task with uncommitted changes, regardless of workflow state. On open, the overlay SHALL call `tasks.getChangedFiles` to obtain the list of changed file paths, then call `tasks.getFileDiff` for the initially selected file.

#### Scenario: Overlay opens from task card badge
- **WHEN** the user clicks the changed-files badge on a task card on the board
- **THEN** the code review overlay opens for that task

#### Scenario: Overlay opens from drawer header badge
- **WHEN** the user clicks the changed-files badge in the task detail drawer header
- **THEN** the code review overlay opens for that task

#### Scenario: Overlay shows file list and Monaco diff
- **WHEN** the overlay opens and has received file paths from `tasks.getChangedFiles`
- **THEN** the file list panel shows all changed files and the first file is selected with its Monaco DiffEditor loaded

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

### Requirement: Overlay header has filter and refresh controls
The system SHALL provide a filter dropdown (All / Unreviewed / Needs Action / Accepted) and a Refresh button in the overlay header. The filter applies to both the file list and the hunk list. The Refresh button re-fetches the changed file list and reloads the current file's diff.

#### Scenario: Filter hides reviewed hunks
- **WHEN** the user selects "Unreviewed" in the filter
- **THEN** only hunks with `decision: 'pending'` are shown

#### Scenario: Refresh updates file list and diff
- **WHEN** the user clicks Refresh
- **THEN** `tasks.getChangedFiles` is re-called and the active file's diff is reloaded

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

### Requirement: File list shows aggregate decision state per file
The system SHALL derive and display an aggregate decision state for each file in the file list based on its hunks' individual decisions.

Aggregation rules (in priority order):
- Any hunk `rejected` → file shows `rejected` (❌)
- Any hunk `change_request` (and no rejections) → file shows `change_request` (📝)
- All hunks `accepted` → file shows `accepted` (✅)
- Otherwise → file shows `pending` (⬜)

#### Scenario: File with mixed decisions shows dominant state
- **WHEN** a file has one accepted hunk and one change_request hunk
- **THEN** the file list shows the change_request indicator for that file

#### Scenario: File with any rejection shows rejected indicator
- **WHEN** a file has one change_request hunk and one rejected hunk
- **THEN** the file list shows the rejected indicator regardless of other decisions

#### Scenario: All-accepted file shows accepted indicator
- **WHEN** all hunks in a file are accepted
- **THEN** the file list shows the accepted indicator (✅) for that file

### Requirement: Submit sends structured code_review message to the model
The system SHALL provide a Submit Review button in the overlay (visible only in Review mode). On submit, the system SHALL:
1. Send `{ _type: "code_review" }` via `tasks.sendMessage` — no payload in the envelope
2. The backend reads all human decisions from `task_hunk_decisions` for the task and builds the `CodeReviewPayload`
3. Create a `"code_review"` ConversationMessage with JSON content containing the full decision set
4. Inject a plain-text user-role message to the LLM summarizing only the actionable items
5. Trigger a new execution in the task's current column with its existing toolset
6. Close the review overlay

Undecided (`pending`) hunks on submit SHALL be treated as implicitly accepted and SHALL NOT appear in the submit message.

The Submit button SHALL be disabled if any `change_request` hunk is missing a required comment.

#### Scenario: Submit with only accepted hunks
- **WHEN** all hunks across all files are accepted and the user clicks Submit
- **THEN** the review message is sent with no rejected or change_request items, and the model receives a message indicating all changes were accepted

#### Scenario: Submit with rejected and change_request items
- **WHEN** the user submits with some rejected and change_request hunks
- **THEN** the model receives a structured user message listing only the rejected and change_request items with their comments

#### Scenario: Submit button disabled with incomplete change_request
- **WHEN** one or more hunks are in change_request state without a saved comment
- **THEN** the Submit button is disabled

#### Scenario: Undecided hunks treated as accepted on submit
- **WHEN** some hunks are still in pending state at submit time
- **THEN** those hunks are treated as accepted and the Submit button shows a "(N undecided)" warning count

#### Scenario: Overlay closes after submit
- **WHEN** the user submits the review
- **THEN** the overlay closes and the task's conversation shows a new code_review message

### Requirement: tasks.getChangedFiles RPC returns changed file paths
The system SHALL expose a `tasks.getChangedFiles(taskId: number): string[]` RPC that runs `git diff HEAD --name-only --diff-filter=ACDMR` in the task's worktree and returns the list of changed file paths. Returns an empty array if the worktree is clean or does not exist.

#### Scenario: Returns paths for changed files
- **WHEN** the task's worktree has uncommitted changes
- **THEN** `tasks.getChangedFiles` returns an array of file paths, one per changed file

#### Scenario: Returns empty array for clean worktree
- **WHEN** the task's worktree has no uncommitted changes
- **THEN** `tasks.getChangedFiles` returns an empty array

### Requirement: tasks.getFileDiff RPC returns HEAD and worktree content for a file
The system SHALL expose a `tasks.getFileDiff(taskId: number, filePath: string): { original: string; modified: string }` RPC. `original` is the file's content at HEAD (`git show HEAD:<path>`, or empty string if the file is new). `modified` is the current worktree file's content (or empty string if the file has been deleted).

#### Scenario: Returns both sides for a modified file
- **WHEN** `tasks.getFileDiff` is called for a file that exists in both HEAD and the worktree
- **THEN** `original` contains the HEAD content and `modified` contains the current worktree content

#### Scenario: Returns empty original for a new file
- **WHEN** `tasks.getFileDiff` is called for a file not present in HEAD
- **THEN** `original` is an empty string and `modified` contains the file's current content

#### Scenario: Returns empty modified for a deleted file
- **WHEN** `tasks.getFileDiff` is called for a file present in HEAD but deleted in the worktree
- **THEN** `original` contains the HEAD content and `modified` is an empty string

### Requirement: tasks.rejectHunk RPC reverts a single hunk in the worktree
The system SHALL expose a `tasks.rejectHunk(taskId: number, filePath: string, hunkIndex: number): { original: string; modified: string }` RPC that:
1. Runs `git diff HEAD <filePath>` in the worktree to obtain the current diff
2. Extracts the hunk at `hunkIndex` (0-based)
3. Generates the inverse patch for that hunk
4. Applies it with `git apply --reverse --whitespace=fix`
5. Returns the updated `{ original, modified }` content (same shape as `tasks.getFileDiff`)

If the inverse patch fails to apply (e.g. due to manual edits), the RPC SHALL return an error with a human-readable message.

#### Scenario: Successful hunk revert updates the worktree file
- **WHEN** `tasks.rejectHunk` is called for a valid hunk index
- **THEN** the hunk is reverted in the worktree, the file content is updated, and the new `{ original, modified }` is returned

#### Scenario: Failed revert returns error
- **WHEN** the inverse patch cannot be applied (conflicting manual edits)
- **THEN** the RPC returns an error and the worktree file is left unchanged
