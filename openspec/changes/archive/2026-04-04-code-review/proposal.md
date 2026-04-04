## Why

Railyin tasks produce file changes in git worktrees, but there is no structured way for the human to review those changes, accept or reject them, and send targeted feedback back to the model. The workflow assumes the model's output is correct, with no mechanism for iterative human-in-the-loop review. Adding a code review flow makes Railyin suitable for real collaborative development where human judgment is part of the process.

## What Changes

- New "changed files" badge appears on task cards and in the task detail drawer whenever `git diff HEAD` shows uncommitted changes in the task's worktree
- New full-screen overlay opens from the badge in **Changes mode** (read-only diff browser) with a **"Start Review"** button to enter **Review mode**
- **Changes mode**: browse all changed files with Monaco side-by-side diff; decisions from prior reviews are shown as badges; filter by All / Unreviewed / Needs Action / Accepted; Sync button re-fetches from `git diff HEAD`
- **Review mode**: per-hunk action bars become interactive — Accept, Reject (immediate worktree revert), Change Request (fix comment required)
- Hunk decisions are **persisted immediately to SQLite** (`task_hunk_decisions` table) via a new `tasks.setHunkDecision` RPC — decisions survive overlay close, column transitions, and app restarts
- Hunk identity is a **content hash** of `(filePath, originalLines, modifiedLines)` — if the model reproduces the same change, the prior decision is automatically restored; if the code changes, the hunk gets a new hash and resets to pending
- Rejected hunks are reverted immediately using `git apply --reverse` — no batch apply
- On submit, the backend reads current decisions from DB, builds the structured review message, and sends it to the model in the current column
- The `task_hunk_decisions` schema supports a `reviewer_id` axis — future AI reviewer tools will write decisions with their model name as reviewer; the UI will show AI suggestions as advisory annotations alongside human decisions
- New `MessageType`: `"code_review"` for the structured review submission stored in conversation history

## Capabilities

### New Capabilities

- `code-review`: Full human-in-the-loop code review flow — changed file detection, Monaco-based side-by-side hunk review, per-hunk accept/reject/change-request decisions, immediate worktree revert on reject, and structured review message submission to the model

### Modified Capabilities

- `task-detail`: Adds the changed-files badge to the task detail drawer header and the review trigger button
- `task`: Adds the changed-files badge to task cards on the board (visible in any column when files are changed)
- `file-diff-visualization`: Existing inline unified diffs in the conversation remain unchanged; the new review overlay uses Monaco and is a separate surface

## Impact

- **New Vue components**: `CodeReviewOverlay.vue` (two-mode overlay), `ReviewFileList.vue` (file list with filter)
- **Pinia store**: `review.ts` — UI-only state (mode, selected file, filter, optimistic updates); decisions are in DB
- **New SQLite table**: `task_hunk_decisions` with `(task_id, hunk_hash, reviewer_id)` primary key — supports future multi-reviewer scenarios
- **Monaco integration**: `@monaco-editor/loader` added as a dependency for the diff editor
- **New/updated RPC handlers** in `src/bun/handlers/tasks.ts`: `tasks.getChangedFiles`, `tasks.getFileDiff` (extended with hunk decisions), `tasks.rejectHunk` (now writes to DB), `tasks.setHunkDecision` (new, immediate write-through)
- **New message type** `"code_review"` in `src/shared/rpc-types.ts` — excluded from LLM compaction
- **TaskCard.vue** and **task detail drawer**: badge showing changed file count
- **git worktree** utilities: inverse patch generation and application per hunk
