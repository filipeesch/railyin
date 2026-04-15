## Why

The code review overlay uses Monaco's `createDiffEditor` to render file diffs. Three persistent bugs — diff color persistence after hunk decisions, comment zone destruction on file switch, and fragile glyph-margin comment triggers — all stem from the same root cause: fighting Monaco DiffEditor's internal decoration and ViewZone ownership. The DiffEditor owns diff computation, line coloring, and zone lifecycle, making per-hunk accept/reject with custom overlays inherently fragile. Switching to a single regular `monaco.editor.create()` with diff visualization built from backend hunk data (ViewZones for deletions, ModelDecorations for insertions) eliminates the conflict entirely — the same architectural pattern VS Code uses for Copilot's inline review.

## What Changes

- **Replace `MonacoDiffEditor.vue` with `InlineReviewEditor.vue`**: New component uses a single `monaco.editor.create()` (not `createDiffEditor`). The editor shows the modified file content. Diff visualization is rendered on top using backend hunk data: ViewZones display deleted original lines (red background, strike-through), ModelDecorations highlight inserted lines (green background), and ViewZones host HunkActionBar widgets below each hunk.
- **Simplify accept flow to pure DOM removal**: Accept removes the hunk's ViewZone (deleted lines), ModelDecorations (green highlighting), and action bar ViewZone. No model mutation or diff recompute needed — the editor already shows the accepted (modified) content.
- **Simplified reject flow**: Reject calls `tasks.rejectHunk` (git apply --reverse), receives updated file content and hunks, resets the editor model, and re-renders remaining pending hunks from the fresh backend data.
- **Independent zone lifecycles**: Three separate zone Maps (deletionZones, actionBarZones, commentZones) with isolated clear operations. Hunk operations never touch comment zones.
- **Remove side-by-side toggle**: The inline review replaces both inline and side-by-side DiffEditor modes with a single unified view. The toggle button is removed from the overlay header.
- **VS Code–style line comment gutter**: `linesDecorationsClassName`-based "+" indicator on hover, with selection-aware multi-line comment support (same as current design plan, but on a regular editor where it works reliably).

## Capabilities

### New Capabilities

_(none — all changes modify existing capabilities)_

### Modified Capabilities

- `code-review`: Editor rendering changes from DiffEditor to single CodeEditor with inline diff visualization. Accept/reject mechanics change from model mutation to zone removal (accept) and full reload (reject). Side-by-side toggle removed. All business requirements (per-hunk decisions, navigation, submission, persistence) are preserved.
- `code-review-viewzones`: ViewZone architecture changes fundamentally. Hunk action bars remain as ViewZones, but deleted-line rendering is now also via ViewZones (instead of DiffEditor's native rendering). Zone lifecycle is split into three independent Maps. Content-based hunk correlation is replaced by direct rendering from backend hunk line ranges (no more matching ILineChange to API hunks).

## Impact

- `src/mainview/components/MonacoDiffEditor.vue` — Replaced by new `InlineReviewEditor.vue`
- `src/mainview/components/CodeReviewOverlay.vue` — Significant changes: remove DiffEditor integration, replace `onHunksReady` flow with direct hunk rendering, simplify accept to zone removal, simplify reject to model reload, remove side-by-side toggle
- `src/mainview/components/HunkActionBar.vue` — Minor: mounted into ViewZones as before, no behavioral change
- `src/mainview/components/LineCommentBar.vue` — Minor: mounted into ViewZones as before
- `src/mainview/App.vue` — Remove DiffEditor-specific CSS (accepted/rejected hunk decoration overrides)
- `src/mainview/stores/review.ts` — No change expected
- Backend RPCs — No change; all existing RPCs (`getFileDiff`, `setHunkDecision`, `rejectHunk`, etc.) remain as-is
- `src/ui-tests/review-overlay.test.ts` — Tests may need updates for changed DOM structure (no DiffEditor wrapper)
