## Context

This change builds on the `code-review-line-comments` change (fully implemented, tasks 1–10 complete, UI tests pending). All decisions here are compatible with that architecture: no `buildDisplayModel`, stable line numbers, unified zone registry, `sent` lifecycle.

## Goals / Non-Goals

**Goals:**
- Fix LineCommentBar dark theme and clickability
- Resizable file panel in review overlay (localStorage persisted)
- Editable modified side in Monaco (both modes); live-save via `tasks.writeFile`; unified diff in review payload
- Per-turn checkpoints via `git stash create`; diff overlay uses checkpoint ref instead of HEAD
- `ChangedFilesPanel` component above chat input (Cursor-style), context-aware (pending vs. reviewed state)
- `CodeReviewCard` shows only actionable items; adds line comments and manual edits sections with mini-diffs
- Review overlay file list: search input, two-line layout, tooltip
- `getGitStat` structured response
- UI tests for all of the above + 11 pending line comment tests

**Non-Goals:**
- AI-authored line comments
- Checkpoint diffing for untracked files (fallback to HEAD diff)
- Conflict resolution for concurrent external file edits

---

## Decision 1: Remove auto-focus from LineCommentBar

**Chosen:** Remove the `onMounted` double-`requestAnimationFrame` + `focus()` block entirely. The `<textarea>` is a native form element — clicking it focuses it naturally. No `tabindex` needed.

**Why:** Monaco listens to `focusin` events bubbling from its container. When `focus()` is called programmatically on the textarea, the event bubbles through Monaco's root and Monaco's internal focus state machine recaptures focus, creating a fight that makes the textarea appear unresponsive. `HunkActionBar.vue` — which works correctly — never auto-focuses.

**Dark theme fix:** Add explicit `html.dark-mode .line-comment-bar*` rules mirroring the pattern in `HunkActionBar.vue`. Relying on CSS variable fallbacks alone is insufficient because PrimeVue's dark variable injection timing is not guaranteed inside Monaco ViewZone DOM nodes, which are inserted outside the normal Vue tree.

---

## Decision 2: Resizable file panel — CSS flex + drag handle

**Chosen:** A 4px `<div class="review-overlay__splitter">` between `ReviewFileList` and the diff panel. `fileListWidth` is a `ref<number>` (default 220, min 150, max 500) in `CodeReviewOverlay.vue`. On `mousedown` of the splitter, attach `mousemove` and `mouseup` to `document`. Persist to `localStorage('railyn:review-file-list-width')`. Load from localStorage on overlay open.

**Why not a CSS resize handle:** `resize: horizontal` on the file list panel conflicts with Monaco's `automaticLayout: true`, causing relayout races. The explicit `mousedown` drag approach is the same pattern used by VS Code, Cursor, and the existing drawer resize handle in this codebase.

---

## Decision 3: Editable Monaco modified side

**Chosen:** After `initEditor()`, call `editor.getModifiedEditor().updateOptions({ readOnly: false })`. The top-level `readOnly: true` option is removed (it applies to both sides). The original (left) side remains read-only by setting it explicitly: `editor.getOriginalEditor().updateOptions({ readOnly: true })` after `setModel`.

**Content change tracking:** `MonacoDiffEditor` registers `editor.getModifiedEditor().onDidChangeContent()` and emits a `contentChange: [value: string]` event. `CodeReviewOverlay` listens and:
1. Stores `editedContent: Map<filePath, string>` in memory
2. Debounces 500ms, then calls `tasks.writeFile({ taskId, filePath, content })`
3. Tracks `editedFiles: Set<string>` so submit knows which files have manual edits

**`tasks.writeFile` backend:** Resolves `worktreePath` from `task_git_context`, writes `content` to `path.join(worktreePath, filePath)`. Security: validates that the resolved absolute path starts with `worktreePath` (no path traversal).

**Manual edits in payload:** At submit time (`handleCodeReview`), for each file in `editedFiles`, run `git diff HEAD -- <file>` in the worktree (file already on disk from live saves). Parse output as the `unifiedDiff` string. Add to `CodeReviewPayload.manualEdits: ManualEdit[]`.

**rejectHunk collision:** Before `rejectHunk` IPC, if the file has in-memory edits, flush the debounce (call `tasks.writeFile` immediately). After the diff reloads, show a toast: *"Your manual edits to `auth.ts` were also reverted by this rejection."* This is unavoidable because `git apply --reverse` rewrites the file.

**`enableComments` prop:** Rename `reviewMode` → `enableComments` on `MonacoDiffEditor`. Pass `true` whenever the overlay is open (both modes). This enables the glyph margin `+` icon and selection ContentWidget regardless of mode.

---

## Decision 4: Per-turn git checkpoints

**Chosen:** At the **start** of `runExecution` (before the first AI message is sent), call `git stash create` in the worktree. This returns a SHA (or empty string if worktree is clean). Store in `task_execution_checkpoints(execution_id, stash_ref, created_at)`.

**Why start of turn:** The checkpoint represents "what the worktree looked like before this AI turn modified anything." Diffing `checkpoint..current` shows exactly what this turn produced. A checkpoint at end-of-turn would show only user edits (not AI changes), which is wrong.

**`tasks.getFileDiff` change:** Accepts an optional `checkpointRef?: string`. If provided, runs `git diff <checkpointRef> HEAD -- <file>` instead of `git diff HEAD -- <file>`. The overlay passes the checkpoint ref from the last unreviewed execution.

**Checkpoint selection logic (frontend):** On overlay open, query `task_execution_checkpoints` for the most recent execution whose `sent = 0` hunk decisions exist. If found, use that checkpoint ref. If not (first review or all reviewed), fall back to `git diff HEAD` (current behaviour).

**Untracked files:** `git stash create` only covers tracked files. For untracked files, `git diff HEAD` is already the correct baseline (they didn't exist at HEAD). Detect via `git ls-files --error-unmatch <file>` and fall back gracefully.

**`git stash create` is non-destructive:** It creates a stash commit object but does NOT modify the working tree or index. Safe to call during a running AI turn.

---

## Decision 5: ChangedFilesPanel — context-aware, Cursor-style

**Chosen:** New `ChangedFilesPanel.vue` component. Placed in `TaskDetailDrawer.vue` between `<TodoPanel>` and `<div class="task-detail__input">`. Only renders when `changedCount > 0`.

**Two states:**

*Primary (pending hunks exist):*
```
▼  3 hunks pending · 2 files      [ 🔍 Review ]
⬜  CodeReviewOverlay.vue   3 hunks
⬜  auth.ts                 1 hunk
                              show all ↗
```

*Secondary (all reviewed / no pending):*
```
▼  +47 −12 · 3 files changed    [ 🔍 View Changes ]
✅  CodeReviewOverlay.vue  +38  −4
✅  auth.ts                 +7  −8
```

**State determination:** `hasPendingHunks` = at least one file has `task_hunk_decisions` rows with `sent = 0` and `decision = 'pending'`. Query via new `tasks.getPendingHunkSummary({ taskId })` IPC returning `{ filePath, pendingCount }[]`. When empty, show secondary state with numstat data from `tasks.getGitStat`.

**"Review Changes" button:** Always visible in the header row, right-aligned. Opens review overlay in `review` mode. "show all ↗" small link in primary state opens in `changes` mode.

**File row click:** Deep-links into the overlay — sets `reviewStore.selectedFile` to that path before opening.

**Data source:** `tasks.getGitStat` returns `{ files: { path, additions, deletions }[], totalAdditions, totalDeletions }` (structured numstat, replaces raw string). `TaskDetailDrawer` passes this data to `ChangedFilesPanel`.

---

## Decision 6: CodeReviewCard — actionable-only display

**Chosen:** Filter `file.hunks` to only `rejected` and `change_request` decisions. Never show `accepted` or `pending`. Add `lineComments` section below hunks. Add `manualEdits` section at bottom.

**Manual edits:** Each `ManualEdit` shows `filePath` + a `<details>/<summary>` collapsed mini-diff:
```html
<details>
  <summary>src/auth.ts (manually edited)</summary>
  <pre class="mini-diff">@@ -12,3 +12,3 @@
- const isValid = token.length > 0;
+ const isValid = verifyTokenSignature(token);</pre>
</details>
```

**Header badge:** Remove file count. Show only non-zero counts: `❌ N  📝 N  💬 N  ✏️ N`. No badge at all if everything was accepted (show "✅ All changes accepted").

**Line comments:** Rendered the same as change_request hunks but with a `💬` icon and `line N` range label instead of hunk range.

---

## Decision 7: Review overlay file list — search + two-line layout

**Chosen:** Add a `<input type="search" placeholder="Filter files…">` at the top of `ReviewFileList`. Filter is client-side, case-insensitive, matches anywhere in `file.path`. Clear button (×) appears when filter is non-empty.

**Two-line layout:** Each file item renders as:
```
⬜  CodeReviewOverlay.vue       ← 0.85rem, semibold, black/white
    src/mainview/components     ← 0.70rem, muted color, dir path only
```

No truncation needed — stacking eliminates horizontal overflow. Full path in `title` attribute for tooltip.

**`ReviewFileList` no longer needs a fixed `width: 220px`** — the parent splitter controls the width. The component fills `100%` width of whatever the file panel is sized to.

---

## Decision 8: `getGitStat` return type

**Chosen:** Replace `git diff --stat HEAD` with `git diff --numstat HEAD`. Parse tab-separated output `<additions>\t<deletions>\t<path>` into `GitNumstat`:

```ts
interface GitFileNumstat { path: string; additions: number; deletions: number; }
interface GitNumstat {
  files: GitFileNumstat[];
  totalAdditions: number;
  totalDeletions: number;
}
```

Single consumer (`TaskDetailDrawer`) — update it to use the new type. The old `<pre class="side-git-stat">` block is removed.

---

## Decision 9: `diff` npm package for client-side diff

**Chosen:** Add `diff` package (MIT, 6kb gzipped, zero dependencies). Used only in `CodeReviewCard.vue` to generate the unified diff string for the manual edits mini-diff display. The backend uses `git diff HEAD` for the actual payload diff (already on disk).

**Why not write LCS ourselves:** The `diff` package is well-tested, handles edge cases (empty files, trailing newlines, binary content), and produces standard unified diff format.

---

## Risks / Trade-offs

- **`git stash create` on clean worktree:** Returns empty string. Handle by storing `NULL` in `stash_ref` and falling back to HEAD diff. No error.
- **Checkpoint ref validity:** Stash objects are permanent until `git stash drop` or `git gc`. Risk: very long-lived tasks with many turns accumulate stash objects. Mitigation: stash objects are lightweight (~same size as a commit); acceptable for development-tool use.
- **Live save + fast typist:** 500ms debounce means brief periods where disk is behind editor. On tab switch / overlay close, flush the debounce synchronously before clearing `editedContent`.
- **`readOnly: false` on modified editor + line comment glyph:** Both interact with Monaco mouse events. Existing `e.event.preventDefault()` in glyph `onMouseDown` prevents text cursor placement in glyph margin. No conflict expected.
- **Two-line file list layout + narrow panel:** At minimum width (150px), the dir path line may still overflow. Add `overflow: hidden; text-overflow: ellipsis` on the dir line as a safety net.
