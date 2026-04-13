## Context

The code review overlay (`CodeReviewOverlay.vue`) currently wraps Monaco's `createDiffEditor` to render file diffs with per-hunk accept/reject action bars injected as ViewZones. Three systemic bugs — diff color persistence after decisions, comment zone destruction on file switch, and fragile glyph-margin comment triggers — all stem from fighting the DiffEditor's internal ownership of decorations, diff computation, and zone lifecycle.

The backend already provides complete diff data via `tasks.getFileDiff()` → `FileDiffContent { original, modified, hunks: HunkWithDecisions[] }`. Each hunk has explicit line ranges for both original and modified content (`originalContentStart/End`, `modifiedContentStart/End`). This data is sufficient to render diff visualization without relying on Monaco's diff engine.

Monaco's standalone API provides `monaco.editor.create()` for single editors, with full access to `changeViewZones()`, `deltaDecorations()`, `addContentWidget()`, and `colorize()` — all battle-tested APIs that VS Code itself uses for its Copilot inline review flow (`chatEditingCodeEditorIntegration.ts`).

**Codebase constraints**: Monaco is loaded via `@monaco-editor/loader` (CDN). The app runs in Electrobun/WKWebView where Monaco events are occasionally timing-sensitive (existing setTimeout fallbacks in `MonacoDiffEditor.vue`).

## Goals / Non-Goals

**Goals:**
- Eliminate all rendering conflicts caused by DiffEditor decoration ownership
- Accept removes visual diff elements instantly without model mutation or diff recompute
- Reject reloads from backend data cleanly
- Comment zones survive all hunk operations (accept, reject, file switch)
- Line comment creation works reliably with selection-aware multi-line support
- All existing business requirements (per-hunk decisions, navigation, persistence, submission) preserved exactly
- Existing backend RPCs unchanged

**Non-Goals:**
- Side-by-side diff view (removed per user decision)
- Client-side diff computation (backend `git diff` is the source of truth)
- Changes to `HunkActionBar.vue` or `LineCommentBar.vue` component behavior
- Changes to the review store, backend handlers, or data model
- MultiDiffEditor-style scroll-through-all-files (file list + single file view kept)

## Decisions

### Decision 1: Single CodeEditor with manual diff visualization

Replace `MonacoDiffEditor.vue` (which wraps `createDiffEditor`) with `InlineReviewEditor.vue` using `monaco.editor.create()` — a single standard editor.

The editor model contains the **modified** file content (working tree version). Diff visualization is overlaid using three rendering primitives:

1. **Deleted lines → ViewZone** above the insertion point (or at the deletion position). Shows original text with red background and strikethrough. Positioned using `afterLineNumber: hunk.modifiedContentStart - 1` (or `hunk.modifiedStart - 1` for pure deletions).

2. **Inserted lines → ModelDecoration** on actual editor lines. Green background via `deltaDecorations()` covering `modifiedContentStart` through `modifiedContentEnd`.

3. **Action bar → ViewZone** below the last line of each hunk. Same `HunkActionBar` Vue component mounted into the zone DOM, same as today.

**Why this over fixing DiffEditor**: The DiffEditor owns diff computation, line coloring (`.line-insert`, `.line-delete`, `.char-insert`, `.char-delete`), and the ViewZone accessor for both editors. Per-hunk accept/reject inherently conflicts with DiffEditor's whole-file diff model. A single editor with manual rendering eliminates the conflict entirely.

**Why not client-side diff**: Monaco standalone doesn't expose `computeDocumentDiff()` outside of `createDiffEditor`. The backend already computes diffs via `git diff` and returns structured hunk data with exact line ranges. Using backend data directly is simpler and avoids a redundant computation.

### Decision 2: Deletion ViewZone rendering with syntax highlighting

For each hunk with deletions (`originalContentStart > 0`), create a ViewZone that renders the original (deleted) text. Use `monaco.editor.colorize(deletedText, language)` to syntax-highlight the content before inserting it into the ViewZone's DOM node.

The ViewZone DOM structure:
```
<div class="deletion-zone">
  <div class="deletion-zone-content" style="background: var(--deletion-bg)">
    <!-- colorized lines with strikethrough -->
  </div>
</div>
```

**Why colorize over plain text**: Syntax-highlighted deletions let the reviewer read the original code naturally. VS Code's inline review does this. `monaco.editor.colorize()` is a static API that doesn't require an editor instance — it returns a Promise<string> of HTML.

**Fallback**: If `colorize()` is slow or fails in WKWebView, fall back to monospace plain text with red background. This is purely cosmetic and doesn't affect functionality.

### Decision 3: Accept = pure DOM removal (no model mutation)

When the user accepts a hunk:
1. Call `tasks.setHunkDecision()` RPC (same as today)
2. Remove the hunk's deletion ViewZone (red original text)
3. Remove the hunk's insertion ModelDecorations (green background)
4. Remove the hunk's action bar ViewZone
5. Navigate to next pending hunk

**No model mutation needed**. The editor already shows the modified (accepted) content. Removing the visual overlays reveals the clean accepted state.

**Why this over model mutation (Decision 1 from review-overlay-bug-fixes)**: Model mutation was necessary in DiffEditor because Monaco's diff engine would keep showing colored lines until the original model matched the modified one. With a single editor, there is no diff engine running — decorations and ViewZones are the only visual diff representation, and removing them is instant.

**Edge case — overlapping ViewZone line shifts**: Accepting a hunk does NOT change line numbers in the editor (the model stays the same). However, removing a deletion ViewZone changes the visual layout. Other ViewZones positioned by `afterLineNumber` remain correct because their line references are to the model (modified text), not to visual positions.

### Decision 4: Reject = backend reload + full re-render

When the user rejects a hunk:
1. Call `tasks.rejectHunk()` RPC (same as today — runs `git apply --reverse`)
2. Receive updated `FileDiffContent` from backend (new modified text + new hunks)
3. Set editor model to new modified text
4. Clear and re-render all hunk visualizations from fresh backend data

**Why full reload on reject**: Reject changes the file on disk (reverting lines). After the revert, line numbers shift for remaining hunks. The backend already returns the complete updated diff — re-rendering from this data is simpler and more reliable than trying to patch existing zones with shifted line numbers.

### Decision 5: Three independent zone Maps

```
deletionZones: Map<string, { zoneId: string, domNode: HTMLElement }>
actionBarZones: Map<string, { zoneId: string, domNode: HTMLElement, app: App }>
commentZones: Map<string, { zoneId: string, domNode: HTMLElement, app: App }>
```

Keyed by hunk hash (deletion + action bar) or comment ID (comments).

**Clear operations**:
- `clearHunkVisuals(hash)`: removes one hunk's deletion zone + action bar zone + insertion decorations
- `clearAllHunkVisuals()`: clears all deletion zones + action bar zones + insertion decorations
- `clearCommentZones()`: clears all comment zones (only on file switch or overlay close)

Hunk operations (accept, reject) never call `clearCommentZones()`. This is the direct fix for bug #2 (comment zone destruction).

### Decision 6: Direct hunk rendering (no ILineChange correlation)

Current architecture: Monaco DiffEditor computes ILineChange array → overlay correlates each ILineChange to a git hunk by line overlap → injects ViewZones.

New architecture: Backend hunks are rendered directly. Each `HunkWithDecisions` from `getFileDiff()` provides `modifiedContentStart/End` and `originalContentStart/End` — this is all the information needed to place ViewZones and decorations.

**No correlation step**. No "one git hunk may split into multiple ILineChange regions" complexity. One git hunk = one deletion ViewZone + one set of insertion decorations + one action bar ViewZone.

**Why this is safe**: The backend parses `git diff` output and provides canonical hunk boundaries. Monaco's ILineChange splitting was an artifact of DiffEditor's own diff algorithm which could disagree with git's diff on hunk boundaries. Using backend data directly eliminates this mismatch.

### Decision 7: Navigation uses hunk data, not zone lookup

Current navigation (`scrollToPendingHunk`) finds the ViewZone by scanning `hunkZones` Map for a matching hash, then uses `zone.afterLineNumber` to scroll.

New navigation scrolls directly to the hunk's `modifiedStart` (or `modifiedContentStart`) line number using `editor.revealLineInCenter()`. The highlight animation targets the action bar ViewZone's DOM node.

**Pending hunk index and Prev/Next logic** remain identical. Only the scroll target calculation simplifies.

### Decision 8: Line comment gutter via linesDecorationsClassName

Same approach as planned in the review-overlay-bug-fixes change, but on a regular editor where it's well-tested:

- All commentable lines get a `linesDecorationsClassName` decoration (invisible by default)
- On `onMouseMove`, detect hover over the decoration column → switch to visible "+" icon class
- On `onMouseDown` in that column, check `editor.getSelection()`: if multi-line, use selection range; otherwise single line
- Emit comment request to parent

This is the standard Monaco pattern used by VS Code's `CommentingRangeDecorator`.

### Decision 9: Editable modified content during review

Since the editor shows the live modified file, the user can edit it (same as today's modified-side editing in DiffEditor). Content changes trigger `onDidChangeModelContent` → debounced `tasks.patchFile()` RPC (existing flow).

After a manual edit, hunk line ranges may shift. The system calls `tasks.getFileDiff()` to get fresh hunk data and re-renders all visualizations.

**Guard**: Apply a short debounce (500ms) between edit and re-fetch to avoid re-rendering on every keystroke.

## Risks / Trade-offs

**[Risk] Deletion ViewZone height calculation** → ViewZones need explicit `heightInLines` or `heightInPx`. For deletion zones showing N original lines, set `heightInLines: N` (one line per deleted line). If the deletion zone contains lines longer than the viewport width, they'll wrap and exceed the allocated height. Mitigation: use `word-wrap: off` with horizontal scroll in the zone, matching Monaco's own overflow behavior.

**[Risk] `colorize()` performance on large deletions** → For a hunk with hundreds of deleted lines, `colorize()` returns a promise that may take time. Mitigation: render the zone with plain text immediately, replace with colorized content when the promise resolves. This is purely visual — no layout impact.

**[Risk] WKWebView ViewZone rendering timing** → The existing codebase has setTimeout fallbacks for WKWebView. The same pattern applies here. Since we're using fewer ViewZones (no dual-editor zones), timing issues should be less frequent.

**[Trade-off] No side-by-side view** → Users who want traditional side-by-side must use an external tool. This simplifies the codebase significantly. Side-by-side could be re-added later by opening Monaco DiffEditor in a separate "full diff" mode (not integrated with the hunk decision system).

**[Trade-off] Full re-render on reject** → Slightly more work than patching in place, but much simpler and less error-prone. Reject is the less common action (most hunks are accepted), so optimizing it is low priority.

**[Trade-off] Backend is source of truth for diff** → If the file changes on disk between `getFileDiff` and rendering (e.g., agent writes while review is open), the displayed diff may be stale. Mitigation: existing Refresh button and `file_diff` IPC listener already handle this case.
