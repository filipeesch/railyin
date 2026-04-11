## Why

The code review experience has several compounding problems that make it harder to use than tools like Cursor or GitHub Copilot in VS Code:

1. **LineCommentBar is not clickable**: The auto-focus logic in `LineCommentBar.vue` triggers Monaco's internal focus handler, causing Monaco to recapture focus and making the textarea unresponsive. The component also lacks dark-mode CSS overrides, making it visually broken in the app's default dark theme.

2. **No resizable file panel**: The file list in the review overlay has a fixed `width: 220px`. On larger diffs with long paths, this causes clipping and poor readability. The Monaco diff editor cannot be resized to compensate.

3. **Code in the diff is read-only**: Users cannot make quick edits to the modified side while reviewing. Every manual fix requires closing the overlay, editing the file externally, and reopening. This breaks the review flow.

4. **No checkpoints per AI turn**: All diffs are computed against `git diff HEAD`, so changes from multiple AI turns accumulate into a single diff. Users cannot distinguish what changed in the most recent turn from what was reviewed in a previous turn — the core value proposition of tools like Cursor's review mode.

5. **Changed files panel is buried in the sidebar**: The git stat block is a raw `<pre>` in the right sidebar, far from the chat input. It shows no pending review state, no per-file hunk counts, and no review button in a discoverable location.

6. **CodeReviewCard shows noise**: The collapsible review card in the conversation shows all hunks including accepted ones, omits line comments entirely, shows no manual edits, and doesn't render the diff content the model actually receives.

7. **Review overlay file list lacks UX**: No search, filenames truncated from the wrong end, no two-line layout for path legibility.

## What Changes

- **Fix LineCommentBar**: Remove auto-focus (user clicks textarea to focus), add explicit `html.dark-mode` CSS overrides matching `HunkActionBar.vue`'s pattern.
- **Resizable file panel**: Drag handle between file list and Monaco diff in the review overlay; width persisted to `localStorage`.
- **Editable Monaco modified side**: The right (modified) editor becomes editable in both review and changes modes. Edits live-save to disk via a new `tasks.writeFile` IPC (debounced 500ms). On submit, `git diff HEAD -- file` captures the unified diff for the model.
- **Per-turn git checkpoints**: At the start of each AI execution, `git stash create` snapshots the worktree into a new `task_execution_checkpoints` table. The review overlay diffs against this checkpoint instead of HEAD, showing only what changed in the most recent (unreviewed) turn.
- **ChangedFilesPanel**: A new collapsible component placed above the chat input (like Cursor), showing pending hunk counts per file in primary state and `+N −N` line stats in secondary state. Has a "Review Changes" button right-aligned in the header.
- **CodeReviewCard improvements**: Remove accepted hunks; add line comments section; add manual edits section with collapsed mini-diff (option B: transparent); remove file count badge.
- **Review overlay file list**: Search input at top; two-line layout (filename bold + dimmed directory path below); tooltip with full path; clicking a row deep-links to that file.
- **Structured git stat**: `tasks.getGitStat` returns `{ files: {path, additions, deletions}[], totalAdditions, totalDeletions }` instead of a raw string.
- **UI tests**: Cover all new behaviours plus the 11 pending line comment tests from the `code-review-line-comments` change.

## Capabilities

### New Capabilities
- `code-review-checkpoints`: Per-turn git stash snapshots enabling incremental review (only unreviewed changes shown per turn)
- `code-review-editable-diff`: Modified side of Monaco diff is editable; changes live-save to worktree; unified diff included in review payload

### Modified Capabilities
- `code-review`: File list resizable; overlay file list searchable with two-line layout; CodeReviewCard shows only actionable items (rejected, change_request, line_comments, manual_edits); dark-mode and clickability fixes for LineCommentBar
- `code-review-line-comments`: Glyph and range comment triggers enabled in both review and changes modes (renamed `reviewMode` prop to `enableComments`)

## Non-Goals

- AI-authored line comments (infrastructure from `code-review-line-comments` change is already in place; generation not in scope here)
- Checkpoint diffing for files that are untracked by git (fallback to HEAD diff for untracked)
- Rich text / markdown in the comment textarea
- Conflict resolution if the AI modifies a file the user is currently editing in an external editor
- Threaded comment replies

## Impact

- `src/bun/db/migrations.ts` — new `task_execution_checkpoints` table
- `src/bun/workflow/engine.ts` — snapshot checkpoint at start of `runExecution`; `readFileDiffContent` uses checkpoint ref when available
- `src/bun/handlers/tasks.ts` — new `tasks.writeFile` IPC; `tasks.getFileDiff` uses checkpoint ref; `tasks.getGitStat` returns structured numstat
- `src/shared/rpc-types.ts` — `ManualEdit` type; `CodeReviewPayload` gains `manualEdits`; `tasks.writeFile` signature; `getGitStat` return type
- `src/mainview/components/LineCommentBar.vue` — remove auto-focus; add dark-mode CSS
- `src/mainview/components/MonacoDiffEditor.vue` — `readOnly: false` on modified editor; `enableComments` prop replacing `reviewMode`; emit `contentChange` event
- `src/mainview/components/CodeReviewOverlay.vue` — resizable splitter; editable content tracking + debounced save; checkpoint-aware diff loading; deep-link file selection from drawer
- `src/mainview/components/ReviewFileList.vue` — search input; two-line layout; tooltip
- `src/mainview/components/ChangedFilesPanel.vue` — new component
- `src/mainview/components/CodeReviewCard.vue` — filter to actionable hunks; line comments section; manual edits section
- `src/mainview/components/TaskDetailDrawer.vue` — replace gitStat `<pre>` and changed-files badge with `ChangedFilesPanel`; remove badge from header
- `src/ui-tests/review-overlay.test.ts` — new and extended test suites
- `package.json` — add `diff` npm package for client-side unified diff generation
