## Why

The code review overlay has three UX bugs that break the review workflow: (1) accepted/rejected hunks retain Monaco's red/green diff coloring instead of showing a clean decided state, (2) line comments vanish when switching files and returning, and (3) the multi-line comment selection UX is fragile and unfamiliar. These issues make the review mode feel broken and untrustworthy, eroding confidence in the accept/reject workflow that is central to the human-in-the-loop review process.

## What Changes

- **Fix diff color persistence after hunk decisions**: When a hunk is accepted, update the DiffEditor's original model text to match the modified model for that hunk's line range, causing Monaco's diff engine to recalculate and naturally eliminate the diff decorations. When rejected (revert already reloads the diff), ensure no stale decorations linger. Remove the CSS-override approach (`accepted-hunk-decoration`, `rejected-hunk-decoration`) that fights Monaco's internal decoration layer.
- **Fix comment zone persistence across file switches**: Split `clearAllZones()` into `clearHunkZones()` and `clearCommentZones()`. File-switch and diff-refresh flows only clear hunk zones, preserving comment zones. Fix the setTimeout fallback at line 996 that inadvertently wipes comment zones after `loadLineComments()` injects them.
- **Improve line comment UX to VS Code style**: Replace the fragile glyph-margin "+" icon with a `linesDecorationsClassName`-based gutter indicator that shows a "+" on hover. Single click on "+" creates a comment on that line. If the user has a multi-line text selection, the "+" click creates a comment spanning the selection range. Show a visual dotted border on selected multi-line ranges that are commentable.

## Capabilities

### New Capabilities
_(none — all changes modify existing capabilities)_

### Modified Capabilities
- `code-review`: Hunk decision behavior changes — accepted hunks now update the original model to eliminate diff instead of overlaying CSS decorations
- `code-review-viewzones`: ViewZone lifecycle changes — comment zones persist across file switches; hunk zone clearing is separated from comment zone clearing

## Impact

- `src/mainview/components/CodeReviewOverlay.vue` — Major changes to `applyDecisionDecorations()`, `clearAllZones()`, `loadDiff()` setTimeout fallback, and `onRequestLineComment()` flow
- `src/mainview/components/MonacoDiffEditor.vue` — New expose for `getOriginalEditor()` model mutation; replace glyph-margin comment handlers with `linesDecorationsClassName` approach
- `src/mainview/App.vue` — Remove/simplify global CSS for `accepted-hunk-decoration`, `rejected-hunk-decoration` and their compound selectors that no longer apply
- `src/ui-tests/review-overlay.test.ts` — Existing tests should continue passing; test 34.1 (last-hunk navigation) already passes
