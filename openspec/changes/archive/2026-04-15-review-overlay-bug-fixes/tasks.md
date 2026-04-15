## 1. Bug 1 — Diff color persistence after accept/reject

- [ ] 1.1 Expose `getOriginalEditor()` and `getModifiedEditor()` from MonacoDiffEditor.vue so the parent can access the underlying models
- [ ] 1.2 In `onDecideHunk()` accept path: after the RPC call succeeds, compute the hunk's line range in the original model and replace it with the corresponding modified text via `originalModel.pushEditOperations()`
- [ ] 1.3 In `onDecideHunk()` reject path: after `tasks.rejectHunk` returns the new content, replace the hunk's line range in the modified model with the original text via `modifiedModel.pushEditOperations()`
- [ ] 1.4 Remove `applyDecisionDecorations()` and the `accepted-hunk-decoration` / `rejected-hunk-decoration` CSS classes from App.vue that attempted to override Monaco's diff coloring
- [ ] 1.5 Verify `onDidUpdateDiff` fires after model mutation and `onHunksReady` re-injects ViewZones at correct shifted positions

## 2. Bug 2 — Comment zones destroyed on file switch

- [ ] 2.1 Split `clearAllZones()` into `clearHunkZones()` (only hunk action bar ViewZones) and `clearCommentZones()` (only comment ViewZones)
- [ ] 2.2 Update all call sites of `clearAllZones()` in `loadDiff()`, `toggleViewMode`, and reject revert to use `clearHunkZones()` only
- [ ] 2.3 Fix the setTimeout fallback at line ~996 in `loadDiff()` to call `clearHunkZones()` instead of `clearAllZones()`, preventing it from wiping comment zones injected by `loadLineComments()`
- [ ] 2.4 In the file-switch path, clear comment zones for the previous file before calling `loadLineComments()` for the new file
- [ ] 2.5 Verify comments persist across file round-trip: add comment on file A → switch to file B → switch back to file A → comment is visible

## 3. Bug 3 — Line comment UX improvement

- [ ] 3.1 Replace the `glyphMarginClassName`-based comment trigger in MonacoDiffEditor.vue with a `linesDecorationsClassName`-based approach that shows a "+" on hover
- [ ] 3.2 Add CSS for the three decoration states: base (invisible gutter slot), hover (visible "+" icon), and multi-line selection (dotted border)
- [ ] 3.3 On "+" click, read `editor.getSelection()` — if multi-line, use selection range; otherwise use single clicked line — then emit the comment creation event
- [ ] 3.4 Gate the comment decorations behind Review mode — no "+" indicators in Changes mode
- [ ] 3.5 Remove the old multi-line selection widget code (`showCommentWidget` / `hideCommentWidget`) that is replaced by the selection-aware approach

## 4. Navigation — Last pending hunk advances to next file

- [ ] 4.1 Verify `navigateToNextFile()` correctly advances to the next pending file when the last hunk in the current file is decided (this was fixed in an earlier session — confirm it still works)
- [ ] 4.2 Ensure the file list updates the aggregate decision indicator when all hunks in a file are decided

## 5. Cleanup and testing

- [ ] 5.1 Remove any unused CSS rules, stale decoration helper functions, and dead code paths from the old CSS-overlay approach
- [ ] 5.2 Run `bun test src/ui-tests/review-overlay.test.ts --timeout 120000` and verify test 34.1 passes along with the full suite
- [ ] 5.3 Run `bun test src/bun/test --timeout 20000` to verify backend tests are not regressed
- [ ] 5.4 Manual smoke test: accept/reject hunks in multi-hunk files, verify colors clear and navigation works
