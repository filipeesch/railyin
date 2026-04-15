## Context

The review overlay (`CodeReviewOverlay.vue` + `InlineReviewEditor.vue`) uses a single Monaco editor with ViewZone-based diff visualization. Line comments are triggered via a narrow gutter `linesDecorationsClassName` hover target that rarely registers user interaction. Comments are line-range only (no column precision). The file list uses emoji icons for state. The submit flow always sends a message, even when all hunks are accepted. Auto-navigation after hunk decisions can be disorienting.

The gutter mechanism (`registerCommentGutterHandlers`) uses `MouseTargetType === 2` (GUTTER_LINE_DECORATIONS) — a narrow strip that's hard to hit. PrimeVue Dialog is already used elsewhere (CreateTaskDialog, ManageModelsModal). The `task_line_comments` table stores `line_start`/`line_end` integers. `formatReviewMessageForLLM` already excludes accepted/pending hunks from the payload.

## Goals / Non-Goals

**Goals:**
- Replace gutter comment trigger with a floating button above text selections (review mode only)
- Support column-precise comment ranges (L4:C19–C45) in data model, UI, and LLM payload
- Show inline amber highlight on posted comments; click to toggle the comment ViewZone
- Replace emoji file list icons with flat CSS status dots
- Compute and pass aggregate file states to the file list component
- Close silently when all hunks accepted with no comments or edits
- Show PrimeVue Dialog when submitting with pending hunks remaining
- Remove auto-scroll/auto-navigate on hunk decisions
- Dispatch exact selection text to LLM including column indicators

**Non-Goals:**
- Threaded comments or comment replies
- Multi-user review (single reviewer assumed)
- Changes to HunkActionBar button layout or behavior
- Changes to reject/accept mechanics or backend RPC shape (beyond adding column fields)
- Comment edit-in-place (v3 — for now click highlight shows posted bar with Edit/Delete)

## Decisions

### Decision 1: Selection-based floating button replaces gutter entirely

Remove `updateCommentGutterDecorations()`, `registerCommentGutterHandlers()`, and all related CSS (`.inline-review-comment-gutter`, `.inline-review-comment-gutter--hover`). Remove `commentGutterDecorations` and `gutterHoverDecorations` state.

Add a new `onDidChangeCursorSelection` listener that shows/hides a floating button element when:
- `props.mode === 'review'` and `props.enableComments === true`
- The selection is non-empty (`!selection.isEmpty()`)

The button is an absolutely-positioned `<div>` inside the `InlineReviewEditor.vue` template (sibling of the editor container, not inside Monaco). Its position is computed using `editor.getScrolledVisiblePosition(selection.getStartPosition())` to anchor it above the selection start. It shows "💬 Comment" and on click emits `onRequestLineComment(startLine, endLine, startColumn, endColumn)`.

When the selection clears or mode changes, the button hides.

**Why floating over gutter**: The gutter relies on a 14px-wide Monaco mouse target type that's unreliable across browsers and zoom levels. A floating button above the selection is discoverable, hard to miss, and matches the GitLab/Confluence pattern.

**Why outside Monaco's DOM**: Placing the button as a sibling of the editor container (not a content widget) avoids Monaco lifecycle/disposal issues. Position is recalculated on selection change and editor scroll.

### Decision 2: Column-precise storage with backward-compatible defaults

Add two columns to `task_line_comments`:
```sql
ALTER TABLE task_line_comments ADD COLUMN col_start INTEGER DEFAULT 0;
ALTER TABLE task_line_comments ADD COLUMN col_end INTEGER DEFAULT 0;
```

When `col_start = 0 AND col_end = 0` → full-line comment (backward compatible). When both are set → column-precise selection.

The `LineComment` TypeScript type gains `colStart: number` and `colEnd: number` fields. `tasks.addLineComment` accepts the new fields. `tasks.getLineComments` returns them.

**Why integers with 0 = full-line**: Adding nullable columns would require coalescing everywhere. Using 0 as a sentinel for "whole line" avoids nulls and matches Monaco's 1-based column convention (column 0 is invalid, so it's unambiguous).

### Decision 3: Inline highlight decoration for posted comments

After posting a comment (or loading posted comments from DB), add a Monaco `inlineClassName` decoration covering the exact selection range:

```typescript
editor.deltaDecorations([], [{
  range: { startLineNumber: lineStart, startColumn: colStart || 1,
           endLineNumber: lineEnd, endColumn: colEnd || model.getLineMaxColumn(lineEnd) },
  options: {
    inlineClassName: "inline-review-comment-highlight",
    stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
  }
}]);
```

The highlight uses a subtle amber background: `rgba(250, 204, 21, 0.15)` (light mode), `rgba(250, 204, 21, 0.10)` (dark mode).

An `onMouseDown` listener detects clicks on elements with the `inline-review-comment-highlight` class. When clicked, it toggles the posted comment's ViewZone visibility (show/hide the `LineCommentBar` in posted state below that line).

A separate Map `commentHighlightDecorations: Map<number, string[]>` tracks decoration IDs per comment ID for cleanup.

**Why inlineClassName over whole-line decoration**: `inlineClassName` applies CSS only to the exact character range, not the full line. This matches the Google Docs/Confluence pattern where only the annotated text gets highlighted.

### Decision 4: Flat CSS dots for file status

Replace the `stateIcon()` function's emoji returns with a `<span>` element using CSS classes:

```css
.file-status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.file-status-dot--pending   { border: 1.5px solid var(--p-text-muted-color); background: transparent; }
.file-status-dot--accepted  { background: var(--p-green-400); }
.file-status-dot--rejected  { background: var(--p-red-400); }
.file-status-dot--cr        { background: var(--p-amber-400); }
```

The `ReviewFileList.vue` template changes from `{{ stateIcon(...) }}` to `<span :class="dotClass(...)"></span>`.

**Why CSS over PrimeIcons**: No extra icon font dependency, renders at any DPI, subtle and flat by design. The 8px dot is visually quieter than emoji while still conveying state.

### Decision 5: Aggregate states computed in CodeReviewOverlay

Add a `fileAggregateStates` computed that tracks per-file decision state. It's built from two sources:
1. **Current file hunks**: When `diffContent` changes, update the map for the selected file
2. **Decision events**: When `onDecideHunk` fires, update the map for the current file

The map is `reactive(new Map<string, HunkDecision | "pending">())`. On each update, iterate the current file's hunks and apply aggregation rules: any rejected → "rejected", any CR (no rejections) → "change_request", all accepted → "accepted", otherwise → "pending".

Pass as `:aggregate-states="fileAggregateStates"` to `ReviewFileList`.

**Why local tracking over DB query**: A DB query would be more accurate (covers files never loaded) but adds latency on every decision. Local tracking in a reactive Map is instant and covers the common flow (user loads each file at least once). Unvisited files default to "pending" which is correct.

### Decision 6: Partial submit with PrimeVue Dialog

Modify `onSubmit()` to check two conditions before sending:

1. **All accepted + no comments + no manual edits** → call `reviewStore.closeReview()` silently. No message sent. The backend's `formatReviewMessageForLLM` already returns "All changes were accepted. No action required." but there's no point sending this to the LLM.

2. **Pending hunks exist** → show a PrimeVue `Dialog`:
   ```
   "N of M hunks are still pending. Submit your reviewed items?"
   [Cancel] [Submit Anyway]
   ```
   The pending count comes from a new `tasks.getPendingHunkCount(taskId)` RPC that runs:
   ```sql
   SELECT COUNT(*) as total FROM (
     SELECT DISTINCT file_path, hunk_hash FROM task_hunk_decisions
     WHERE task_id = ? AND sent = 0
   ) decided,
   -- compare against total hunks from all files
   ```

   Actually, simpler: query the review store's file list + the loaded hunks. For files not yet loaded, assume all hunks are pending. This gives a conservative count without a new RPC.

   **Simplest approach**: Use `tasks.getFileDiff` data already cached per-file during the session. For unvisited files, show "some files not yet reviewed" in the dialog text rather than an exact count.

If confirmed, proceed with the existing `onSubmit` logic. The payload (rejected + CR + comments + edits) is already correct.

### Decision 7: Remove auto-navigation on hunk decision

In `onDecideHunk()`, remove the block that calls `scrollToPendingHunk()` after accept and `navigateToNextFile()` when the last hunk in a file is decided. The user navigates manually via Prev/Next.

The `fullyDecidedFiles` set and `navigateToNextFile()` function are retained (they're used by Prev/Next cross-file navigation) — only the automatic calls from `onDecideHunk` are removed.

### Decision 8: LLM payload includes column-precise selection text

Update `formatLineComment()` in `review.ts` to emit column indicators when column data is present:

```
Before: • src/utils/data.ts, line 4
After:  • src/utils/data.ts, L4:C19–C45
        Selection: `processData(input, options)`
```

The `lineText` field already stores the selected text. When `colStart > 0`, format the range as `L{line}:C{colStart}–C{colEnd}` and include the selection text verbatim with backtick wrapping. When `colStart = 0`, fall back to the current format.

## Risks / Trade-offs

**[Risk] Floating button position drift on scroll** → The button position is computed from `getScrolledVisiblePosition()` which returns viewport-relative coordinates. On editor scroll, the selection may move while the button stays. Mitigation: listen to `editor.onDidScrollChange` and recompute position, or hide the button on scroll and re-show when scrolling stops.

**[Risk] Inline highlight click detection** → Monaco's `onMouseDown` fires for all clicks. We need to check if the click target has the `inline-review-comment-highlight` class. If Monaco changes its decoration DOM structure, this could break. Mitigation: check both `e.target.element.classList` and walk up to the parent span.

**[Risk] Aggregate state accuracy for unvisited files** → Files never loaded during the session will show "pending" even if they have decisions from a prior session. Mitigation: acceptable UX — the dot updates as soon as the user visits the file. Prior-session decisions are pre-loaded from DB when `loadDiff` runs.

**[Trade-off] No exact pending count across all files** → Showing "some files not yet reviewed" instead of "5 of 12 pending" in the dialog. This avoids a new RPC and complex cross-file tracking. The dialog's purpose is confirmation, not precision.

**[Trade-off] Removing gutter entirely** → Users who preferred single-click line commenting lose that path. All commenting now requires a selection (even a single click creates a zero-width selection that Monaco normalizes). Mitigation: a single click places the cursor, which is a zero-width selection on one line — we can treat this as "select the whole line" if the user clicks the floating button after a cursor placement with no actual selection.
