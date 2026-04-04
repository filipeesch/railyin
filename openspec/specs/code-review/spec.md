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

### Requirement: Code review overlay uses Monaco DiffEditor in side-by-side mode
The system SHALL render a `monaco.editor.createDiffEditor` instance per selected file, configured with `renderSideBySide: true`. The original side SHALL show the HEAD version of the file (`tasks.getFileDiff` original content) and the modified side SHALL show the current worktree version. Monaco SHALL be lazy-loaded via `@monaco-editor/loader` only when the review overlay first opens.

#### Scenario: Side-by-side diff renders correctly
- **WHEN** a file is selected in the review overlay
- **THEN** the left panel shows the HEAD version and the right panel shows the worktree version with changed regions highlighted

#### Scenario: New file shown with empty original
- **WHEN** a new file (not present in HEAD) is selected
- **THEN** the original panel is empty and the modified panel shows all lines as added

#### Scenario: Deleted file shown with empty modified
- **WHEN** a deleted file is selected
- **THEN** the original panel shows all lines and the modified panel is empty

#### Scenario: Monaco not loaded until first overlay open
- **WHEN** the application starts and the review overlay has never been opened
- **THEN** Monaco is not loaded into the page

### Requirement: Code review overlay has two modes: Changes and Review
The system SHALL open the overlay in **Changes mode** by default (read-only). In Changes mode the hunk action bars show the current decision as a badge but are not interactive. A **"Start Review"** button in the header switches the overlay to **Review mode**, where action bars become interactive and a Submit button appears.

#### Scenario: Overlay opens in Changes mode
- **WHEN** the user clicks the changed-files badge
- **THEN** the overlay opens in Changes mode showing decisions as read-only badges

#### Scenario: Switching to Review mode
- **WHEN** the user clicks "Start Review" in the overlay header
- **THEN** the overlay switches to Review mode and action bars become interactive

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
- `accepted`: no worktree effect; excluded from the submit message
- `rejected`: hunk is immediately reverted in the worktree via `tasks.rejectHunk`; included in the submit message with reviewer comment, or default text "The user explicitly rejected this change."
- `change_request`: no worktree effect; included in the submit message; a non-empty comment is **required**
- `pending`: initial state; auto-excluded from submit (not actionable)

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
