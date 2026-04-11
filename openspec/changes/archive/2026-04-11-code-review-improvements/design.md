## Context

This change builds on the completed `code-review-line-comments` change (tasks 10 done, tests 11.11.11 pending). It fixes two regressions introduced by that change (LineCommentBar clickability + dark theme) and adds four larger features: editable diffs, per-turn checkpointing, a Cursor-style changed files panel, and an improved submit card.11

The existing architecture after `code-review-line-comments`:
- `MonacoDiffEditor. diff editor, `readOnly: true`, glyph margin for line comments, selection ContentWidgetvue` 
- `CodeReviewOverlay. unified zone registry (hunks + line comments), `deltaDecorations` for decided hunks, `sent` lifecyclevue` 
- `LineCommentBar. ViewZone component, two states (open / posted)vue` 
- `HunkActionBar. ViewZone component, Accept / Reject / Change Requestvue` 
- `ReviewFileList. fixed 220px panel, no searchvue` 
- `CodeReviewCard. collapsible card in chat timeline, shows all hunksvue` 
- `TaskDetailDrawer. drawer with sidebar, `TodoPanel`, chat inputvue` 
- `engine. `runExecution` ends at `completed`, no checkpoint takents` 
- `review. `formatReviewMessageForLLM` emits rejected/change_request/line_comments but not manual editsts` 

## Goals / Non-Goals

**Goals:**
- LineCommentBar works in dark mode and textarea is clickable
- File list in overlay is resizable and searchable
- Modified side of Monaco diff is editable; edits live-saved to disk; included in LLM payload as unified diff
- Each AI turn creates a git stash checkpoint; review shows only latest turn's changes
- `ChangedFilesPanel` above chat input mirrors Cursor UX
- Submit card shows only actionable items + line comments + manual edits with mini-diff

**Non-Goals:** (see proposal)

## Decisions

### Decision 1: Remove LineCommentBar auto-focus

**Chosen:** Delete the `onMounted` block that calls `textareaEl.value?.focus()` via double `requestAnimationFrame`.

**Why:** Monaco registers `focusin` event listeners on its container. When `focus()` fires on the textarea, the `focusin` event bubbles to Monaco's root element and Monaco recaptures focus, making the textarea unresponsive. `HunkActionBar` has the same event stop guards but never auto- that's why it works. With auto-focus removed, clicking the textarea works normally.focuses 

**Trade-off:** Users must click the textarea after opening a line comment.  this matches `HunkActionBar` behaviour.Acceptable 

### Decision 2: Dark mode CSS pattern for LineCommentBar

**Chosen:** Add explicit `html.dark-mode .line-comment-bar*` overrides at the bottom of `LineCommentBar.vue`'s `<style>` block, identical in structure to the `html.dark-mode .hunk-bar*` overrides in `HunkActionBar.vue`.

**Why:** PrimeVue CSS variables resolve correctly when `html.dark-mode` is set, but some hardcoded fallback values (e.g. `#fff`, `#1e293b`) are light-mode specific. Explicit overrides guarantee correct colours regardless of variable resolution.

### Decision 3: Modified side editable; live-save debounced 500ms

 `tasks.writeFile(taskId, filePath, content)` RPC.

**Why:** Editing only the modified side preserves the diff semantics (original = HEAD, modified = working tree). The 500ms debounce avoids write-on-every-keystroke. Live-save means no edits are lost even if the overlay is closed.

**`tasks.writeFile` implementation:**
```
GET worktree_path from task_git_context
Bun.write(`${worktreePath}/${filePath}`, content)
```
Security: path is joined with worktree path, which is already validated on task creation. No path traversal risk beyond the worktree.

### Decision 4: Manual edit  client-side with `diff` npm packagediff 

**Chosen:** At submit time, for each file with in-memory edits: compute `unifiedDiff(diffContent.modified, currentEditorContent)` using the `diff` npm package (`import { createPatch } from 'diff'`). Include as `ManualEdit[]` in the `CodeReviewPayload`. Backend `handleCodeReview` reads `manualEdits` and passes to `formatReviewMessageForLLM`.

**Why:** The baseline for the manual edit diff is `diffContent.modified` (the AI's version), not `HEAD`. `git diff HEAD` on the file would conflate AI changes + user edits. The `diff` package produces standard unified diff output and is the right tool. No server round-trip needed.

**Payload addition:**
```ts
interface ManualEdit {
  filePath: string;
 user's edits
}
// CodeReviewPayload gains: manualEdits?: ManualEdit[]
```

### Decision 5: Flush editor before rejectHunk

**Chosen:** In `CodeReviewOverlay.onDecideHunk` (reject path), before calling `tasks.rejectHunk`: if the file has in-memory edits, call `tasks.writeFile` immediately (no debounce), then show a PrimeVue `useToast()` warning: `"Your manual edits to ${filePath} were also reverted by this rejection."` Then proceed with reject.

**Why:** `git apply --reverse` overwrites the file. If user has live-saved edits, they need to know. Flushing first ensures the last editor state is on disk before the revert; the toast explains what happened.

### Decision 6: git stash checkpoint per AI turn

**Chosen:** At the START of `runExecution` (before the first `provider.chat` call), run:
```
git stash create
```
If output is non-empty (returns a SHA), insert into `task_execution_checkpoints(execution_id, stash_ref)`.

**DB:**
```sql
CREATE TABLE IF NOT EXISTS task_execution_checkpoints (
  execution_id  INTEGER PRIMARY KEY REFERENCES executions(id),
  stash_ref     TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

**In `getFileDiff` / `handleCodeReview`:** find the most recent checkpoint for the task from a SUBMITTED review round:
```sql
SELECT tec.stash_ref
FROM task_execution_checkpoints tec
JOIN executions e ON tec.execution_id = e.id
WHERE e.task_id = ?
  AND e.id < (SELECT MAX(id) FROM executions WHERE task_id = ?)
ORDER BY tec.execution_id DESC
LIMIT 1
```
Use `git diff <stash_ref> -- <file>` instead of `git diff HEAD -- <file>`. Fall back to `HEAD` if no checkpoint or file is untracked.

**Why start of turn, not end:** The checkpoint must capture the worktree state *before* the AI makes changes. At end-of-turn, the AI's writes are already  the diff would be empty.done 

**Untracked files:** `git stash create` only stashes tracked files. For untracked files (`git ls-files --others`), fall back to `git diff HEAD`.

### Decision 7:  Cursor-style, context-awareChangedFilesPanel 

**Chosen:** New `ChangedFilesPanel.vue` component. Placement: between `<TodoPanel>` and `<div class="task-detail__input">` in `TaskDetailDrawer`. Collapsible (default expanded when pending hunks exist). Uses same border-top + background pattern as `TodoPanel`.

**Two states:**

*Pending state* (unsent `task_hunk_decisions` exist for this task):
 filename   N hunks` `
N)` opens overlay in changes mode

*Reviewed state* (no unsent decisions):
N`

**Data sources:**
 `Record<filePath, number>`
- Line counts: `tasks.getGitNumstat(taskId)` (renamed from `getGitStat`)
- Clicking a file row: `reviewStore.openReview(taskId, files)` + `reviewStore.selectedFile = path`

**Review button:** always visible in header (not hidden when collapsed). Opens overlay in review mode.

**Removes:** `gitStat` `<pre>` block from  N` header badge.sidebar, `

### Decision 8:  search + two-line layoutReviewFileList 

**Chosen:**
- Add `<input type="text" placeholder="Search " />` at the top of `ReviewFileList`files
- Replace single-line item with two-line stacked layout: filename (bold, 0.85rem) on line 1, directory path (muted, 0.70rem) on line 2
- Remove `review-file-list__dir`  stacking eliminates horizontal overflowtruncation 
- Accept `width` as a prop (controlled by `CodeReviewOverlay` for resizable splitter)
- `title` attribute on each item = full path (tooltip)

### Decision 9: Resizable splitter

**Chosen:** Thin `<div class="review-overlay__splitter">` (4px wide, `cursor: col-resize`) between `ReviewFileList` and `.review-overlay__diff-panel`. `fileListWidth: ref(220)` in `CodeReviewOverlay`, bound as `:style="{ width: fileListWidth + 'px' }"` on `ReviewFileList`.

 attach `mousemove` + `mouseup` to `document`. `mousemove`: `fileListWidth = clamp(e.clientX - overlayLeft, 150, 500)`. `mouseup`: detach listeners, save to `localStorage('railyin:review-file-list-width')`.

### Decision 10: enableComments rename + both modes

**Chosen:** Rename `reviewMode` prop on `MonacoDiffEditor` to `enableComments`. In `CodeReviewOverlay`, always pass `:enableComments="true"` (regardless of `reviewStore.mode`). The glyph margin and selection ContentWidget are available in both review and changes modes.

### Decision 11: Updated CodeReviewCard

**Chosen:**
- Filter: only show `rejected` and `change_request` hunks (drop `accepted` and `pending`)
 path, line N: "comment"` `
- Add `manualEdits` section: per file, collapsed `<details>` showing unified diff in `<pre>` block
- Badge counts: `{ rejected, change_request, lineComments,  no file countmanualEdits }` 
- If all accepted + no comments + no edits: show All changes accepted" (existing behaviour in `formatReviewMessageForLLM`) 

### Decision 12: formatReviewMessageForLLM extended with manual edits

**Chosen:** Add  MANUAL EDITS` section after line comments:a `
```
 MANUAL  user directly modified the file (already on disk):EDITS 

 src/auth.ts  
    @@ -12,3 +12,3 @@
    - const isValid = token.length > 0;
    + const isValid = verifyTokenSignature(token);
```

 `formatReviewMessageForLLM`.

## Risks / Trade-offs

- **`diff` package dependency**: small, stable, widely used. Low risk.
- **Stash accumulation**: `git stash create` objects accumulate. Not cleaned up here. Low immediate  stash objects are GC-eligible after 30 days by default. Pruning is a separate task.risk 
- **Checkpoint not created on cancelled turns**: if a turn is cancelled before the first `provider.chat` call completes, no checkpoint is stored. This is  cancelled turns didn't change files.acceptable 
- **Live-save and rejectHunk race**: if user rejects faster than the 500ms debounce, the pre-flush call in `onDecideHunk` catches it. No race.
- **`getGitStat` breaking change**: single consumer (`TaskDetailDrawer`), updating both sides atomically. No risk.
