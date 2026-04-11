## Why

The code review overlay and surrounding UI have several compounding issues that degrade the review experience:

1. **LineCommentBar is broken**: the textarea is not clickable (Monaco recaptures focus after the auto-focus call) and the component ignores the app's dark theme (missing `html.dark-mode` CSS overrides present in every other similar component).

2. **File list is fixed-width and cramped**: `ReviewFileList` has a hardcoded `width: 220px` with no way to resize. Long file paths clip, and there is no way to search/filter when a task has many changed files.

3. **Code cannot be edited in the review overlay**: Monaco is hardcoded `readOnly: true`. Reviewers need to make small manual corrections directly in the modified side without leaving the overlay.

4. **AI changes accumulate across turns without checkpointing**: The diff is always `git diff HEAD`, so when an AI makes changes across multiple turns, all turns' changes pile up in the review. There is no way to see only what the latest turn changed. This is the core Cursor/Copilot behaviour that is missing.

5. **The "Changed Files" panel is in the wrong place**: It lives in a collapsed sidebar as a raw `git diff --stat` `<pre>` block. Cursor and Copilot surface pending review files just above the chat  right where the user's attention already is.input 

6. **The submit review card is noisy and incomplete**: `CodeReviewCard` shows accepted hunks (which need no attention), omits line comments entirely, and omits manual edits. The model sees all this context but the user cannot verify what was sent.

## What Changes

- **Fix LineCommentBar**: remove `onMounted` auto-focus; add explicit `html.dark-mode` CSS rules matching `HunkActionBar`.
- **Resizable file list + search**: drag handle between file list and Monaco panel (width persisted to `localStorage`); search textbox at top of file list; two-line item layout (filename bold + dimmed directory path) to eliminate overflow clipping.
- **Editable modified side**: `editor.getModifiedEditor().updateOptions({ readOnly: false })`; live-save via new `tasks.writeFile` RPC (debounced 500ms); manual edit diff computed client-side (`diff` npm package) against `diffContent.modified` baseline; flushed to disk before `rejectHunk` with toast warning.
- **Per-turn git checkpoints**: `git stash create` at the START of each `runExecution` call (before first tool call); new `task_execution_checkpoints(execution_id, stash_ref)` DB table; `getFileDiff` / `handleCodeReview` diff against `<stash_ref>` instead of `HEAD` when a checkpoint exists for the prior review; untracked files fall back to `HEAD` diff.
N` line counts when all reviewed. "Review Changes" button right-aligned in collapsible header. Clicking a file row opens the overlay on that file. Removes the `gitStat` raw `<pre>` block from the sidebar and  N` header badge.the `
 structured numstat**: replace raw `git diff --stat` string with `{ files: { path, additions, deletions }[], totalAdditions, totalDeletions }` parsed from `git diff --numstat HEAD`.
- **Updated `CodeReviewCard`**: remove accepted hunks; add line comments section; add manual edits section with collapsed mini-diff per file ( user sees exactly what the model received); count badge shows only actionable items (rejected, change_request, line comments, manual edits).transparency 
 `enableComments`** on `MonacoDiffEditor`; always pass `true` when overlay is open so glyph margin and selection widget work in both review and changes modes.
- **UI tests**: cover all new features and the 11 pending line comment tests (suites T in `review-overlay.test.ts`).M

## Capabilities

### New Capabilities
- `code-review-editable`: manual edits to the modified side of the diff with live-save and model-visible unified diff payload
- `code-review-checkpoints`: per-turn git checkpointing so each review round shows only the latest turn's changes

### Modified Capabilities
- `code-review`: overlay file list is now resizable with search; LineCommentBar dark theme and clickability fixed; submit card shows line comments and manual edits; `enableComments` works in both review and changes modes
 `enableComments` rename; glyph margin active in both overlay modes

## Non-Goals

- Commenting on the original (left) side of the diff
- Checkpoint-based diffing for individual file diffs inside the overlay during a review session (checkpoints only affect which changes are shown per review round)
- Rich text / markdown in comment textareas
- AI-authored line comments (infrastructure ready, not triggered here)
- Checkpoint pruning / cleanup (stash objects accumulate; pruning is a separate housekeeping task)

## Impact

- `src/bun/db/migrations. new `task_execution_checkpoints` tablets` 
- `src/bun/workflow/engine. `git stash create` at start of `runExecution`ts` 
- `src/bun/handlers/tasks. new `tasks.writeFile`; updated `getGitStat`; checkpoint-aware `getFileDiff` / `rejectHunk`ts` 
- `src/shared/rpc-types. `ManualEdit` type; `CodeReviewPayload.manualEdits`; `tasks.writeFile` signature; `GitNumstat` type; `getGitStat` return typets` 
- `src/mainview/components/LineCommentBar. remove auto-focus; add dark CSSvue` 
 `enableComments`; `onDidChangeModelContent` emit
- `src/mainview/components/CodeReviewOverlay. resizable splitter; live-save; flush-before-reject; pass `enableComments`vue` 
- `src/mainview/components/ReviewFileList. search box; two-line layout; dynamic width propvue` 
- `src/mainview/components/CodeReviewCard. filter accepted; add line comments + manual edits sectionsvue` 
- `src/mainview/components/TaskDetailDrawer. add `ChangedFilesPanel`; remove `gitStat` sidebar; remove header badgevue` 
- `src/mainview/components/ChangedFilesPanel. new componentvue` 
- `src/bun/workflow/review. `formatReviewMessageForLLM` extended with manual edits sectionts` 
- `src/ui-tests/review-overlay.test. new and extended teststs` 
