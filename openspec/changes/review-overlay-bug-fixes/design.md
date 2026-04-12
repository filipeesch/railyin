## Context

The code review overlay (`CodeReviewOverlay.vue`) uses Monaco's `createDiffEditor` to render file diffs with per-hunk accept/reject action bars injected as ViewZones. Three bugs undermine the review workflow:

1. **Diff color persistence**: After accepting or rejecting a hunk, Monaco's built-in `.line-insert`, `.line-delete`, `.char-insert`, `.char-delete` CSS classes remain visible. Our `deltaDecorations`-based overlays (e.g. `accepted-hunk-decoration`) target different DOM elements than Monaco's own diff decorations — the compound selectors never match, so red/green colors persist.

2. **Comment zone destruction**: `clearAllZones()` destroys both hunk zones and comment zones indiscriminately. The `loadDiff()` setTimeout fallback at line 996 calls `clearAllZones()` again if `hunkZones.size === 0`, wiping comment zones that `loadLineComments()` injected 180ms earlier.

3. **Fragile comment selection**: The glyph-margin "+" approach requires clicking a small target. Multi-line comments rely on text selection state which is easy to lose.

**Codebase constraints**: Monaco is loaded via `@monaco-editor/loader` (CDN). The DiffEditor exposes `getOriginalEditor()` and `getModifiedEditor()` which both have full `IStandaloneCodeEditor` APIs including model mutation.

## Goals / Non-Goals

**Goals:**
- Accepted hunks show only the accepted (modified) content with no diff coloring
- Rejected hunks revert cleanly (already works via model swap, just ensure no stale decorations)
- Comment zones survive file-switch round-trips
- Multi-line comment creation is intuitive and reliable
- All existing UI tests continue passing

**Non-Goals:**
- Implementing a full GitLab-style gutter drag UX (complex, unfamiliar in Monaco context)
- Switching from DiffEditor to single CodeEditor with custom diff rendering (too large a refactor)
- Per-character accepted/rejected animations or transitions
- Persisting comment zones across overlay close/reopen (comments are re-loaded from DB)

## Decisions

### Decision 1: Mutate original model on accept (VS Code pattern)

When a hunk is accepted, copy the modified editor's text for that hunk's line range into the original editor's model. Monaco's diff engine recalculates automatically — the accepted lines now match on both sides, so no diff appears for that range.

**Why this over CSS overrides**: VS Code's `chatEditingTextModelChangeService.ts` uses this exact pattern (`originalModel.pushEditOperations` with modified text). It works because it eliminates the diff at the source rather than fighting Monaco's decoration layer. Our current CSS approach fails because Monaco's diff classes and `deltaDecorations` classes live on different DOM elements.

**Why this over hiding the diff editor entirely**: The `.no-diff` CSS toggle (used by VS Code's `codeBlockPart.ts`) hides the whole editor — too aggressive for per-hunk decisions where other hunks are still pending.

**Implementation**: After a successful accept RPC call, get both editors' models, compute the line range mapping, apply edits to the original model. Monaco fires `onDidUpdateDiff` → `onHunksReady` re-injects remaining ViewZones at correct positions.

### Decision 2: Separate hunk zone and comment zone lifecycles

Split `clearAllZones()` into `clearHunkZones()` (only hunk action bars) and `clearCommentZones()` (only comment widgets). All diff-refresh paths (`loadDiff`, `onHunksReady`, `toggleViewMode`, reject revert) call `clearHunkZones()` only. Comment zones are managed independently — cleared only on file switch (before loading new file's comments) or overlay close.

Fix the setTimeout fallback to guard `clearHunkZones()` only, never touching comment zones.

### Decision 3: VS Code–style linesDecorationsClassName comment trigger

Replace the `glyphMarginClassName`-based hover "+" with a `linesDecorationsClassName`-based approach:
- All commentable lines get a narrow gutter decoration (invisible by default)
- On hover, the hovered line's decoration switches to a visible "+" icon class
- On click, check `editor.getSelection()`: if it spans multiple lines, use that range; otherwise use the single clicked line
- Show a dotted border on the selected range when multi-line

This matches VS Code's `CommentingRangeDecorator` pattern from `commentsController.ts`. It avoids custom drag tracking while providing reliable multi-line support through the editor's built-in selection.

## Risks / Trade-offs

**[Risk] Original model mutation triggers full diff recompute** → This is actually desired — Monaco re-fires `onDidUpdateDiff`, which calls `onHunksReady`, which re-injects ViewZones for remaining pending hunks at their now-correct line positions. The recompute is fast (< 50ms for typical files).

**[Risk] Line range mapping between API hunks and Monaco models may drift** → After an accept mutates the original model, line numbers shift. We already handle this via content-based hunk correlation in `onHunksReady`. The existing mapping logic is robust here.

**[Risk] Comment zones may shift position after original model mutation** → Comment zones use `afterLineNumber` which is stable in the modified editor (we don't touch modified on accept). For reject (which replaces the modified model), comments are reloaded from DB via `loadLineComments()`.

**[Trade-off] VS Code–style comment selection requires two actions for multi-line (select then click)** → This is the VS Code standard. Users familiar with VS Code/GitHub review will find it natural. A single-action drag UX (GitLab style) would require ~80 more lines of custom mouse tracking code with fragile edge cases.
